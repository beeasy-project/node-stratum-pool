JSON.minify = JSON.minify || require("node-json-minify");
const events = require('events');
const crypto = require('crypto');
const fs = require('fs');
const bignum = require('bignum');

const util = require('./util.js');
let blockTemplate = require('./blockTemplate.js');
let blockTemplateEthereum = require('./blockTemplate_Ethereum.js');


//Unique extraNonce per subscriber
class ExtraNonceCounter {
    constructor(configInstanceId) {
        let instanceId = configInstanceId || crypto.randomBytes(4).readUInt32LE(0);
        this.counter = instanceId << 0;
        this.size = 4; //bytes
    }

    next() {
        let extraNonce = util.packUInt32BE(Math.abs(this.counter++));
        return util.pad(extraNonce.toString('hex'), 8, 0).substring(this.size, 7);
    };
}

class ExtraNonceCounterStratum {
    constructor(ignore) {
        this.counter = 0;
        this.size = 3; //bytes
        this.extra_counter = 0;
    }

    next() {
        let extraNonce = (this.extra_counter * 0x100 ) + this.counter++;
        let res = extraNonce.toString(16);
        res = res.substring(8 - (this.size + 1) * 2, 8);
        return res;
    };
}

//Unique job per new block template
class JobCounter {
    constructor() {
        this.counter = 0;
    }

    next() {
        this.counter++;
        if (this.counter % 0xffff === 0)
            this.counter = 1;
        return this.cur();
    };

    cur() {
        return this.counter.toString(16);
    };
}

/**
 * Emits:
 * - newBlock(blockTemplate) - When a new block (previously unknown to the JobManager) is added, use this event to broadcast new jobs
 * - share(shareData, blockHex) - When a worker submits a share. It will have blockHex if a block was found
 **/
class JobManager {
    constructor(options) {
        //private members
        this.jobCounter = new JobCounter();
        this.shareMultiplier = algos[options.coin.algorithm].multiplier;

        //public members
        if (options.type === "stratum") {
            this.extraNonceCounter = new ExtraNonceCounterStratum(options.instanceId);
            blockTemplate = blockTemplateEthereum;
        } else {
            this.extraNonceCounter = new ExtraNonceCounter(options.instanceId);
        }
        this.extraNoncePlaceholder = new Buffer('f000000ff111111f', 'hex');
        this.extraNonce2Size = this.extraNoncePlaceholder.length - this.extraNonceCounter.size;

        // this.currentJob;
        this.validJobs = {};
        this.previousJobs = {};

        this.hashDigest = algos[options.coin.algorithm].hash(options.coin);

        if (options.coin.algorithm === 'dagger') {
            this.hashDigest_mix = algos[options.coin.algorithm].mixhash(options.coin);
        }
        this.options = options;
    }

    updateCurrentJob(rpcData) {
        let tmpBlockTemplate = new blockTemplate(
            this.jobCounter.next(),
            rpcData,
            this.options.poolAddressScript,
            this.extraNoncePlaceholder,
            this.options.coin.reward,
            this.options.coin.txMessages,
            this.options.recipients
        );

        this.currentJob = tmpBlockTemplate;
        this.emit('updatedBlock', tmpBlockTemplate, true);
        //this.previousJobs = this.validJobs;
        this.validJobs[tmpBlockTemplate.jobId] = tmpBlockTemplate;

    };

    //returns true if processed a new block
    processTemplate(rpcData) {
        /* Block is new if A) its the first block we have seen so far or B) the blockhash is different and the
         block height is greater than the one we have */
        let isNewBlock = typeof(this.currentJob) === 'undefined';
        if (!isNewBlock && this.currentJob.rpcData.previousHash !== rpcData.previousHash) {
            isNewBlock = true;

            //If new block is outdated/out-of-sync than return
            if (rpcData.height < this.currentJob.rpcData.height)
                return false;
        }

        if (!isNewBlock) return false;


        let tmpBlockTemplate = new blockTemplate(
            this.jobCounter.next(),
            rpcData,
            this.options.poolAddressScript,
            this.extraNoncePlaceholder,
            this.options.coin.reward,
            this.options.coin.txMessages,
            this.options.recipients
        );

        this.currentJob = tmpBlockTemplate;

        this.previousJobs = this.validJobs;
        this.validJobs = {};
        this.emit('newBlock', tmpBlockTemplate);
        this.validJobs[tmpBlockTemplate.jobId] = tmpBlockTemplate;

        return true;

    };

    processShare(jobId, previousDifficulty, difficulty, extraNonce1, extraNonce2, nTime, nonce, ipAddress, port, workerName) {
        const shareError = (error) => {
            this.emit('share', {
                job: jobId,
                ip: ipAddress,
                worker: workerName,
                difficulty: difficulty,
                error: error[1]
            });
            return {error: error, result: null};
        };

        if (extraNonce2.length / 2 !== this.extraNonce2Size)
            return shareError([20, 'incorrect size of extranonce2']);

        let job = this.validJobs[jobId];

        if ((typeof job === 'undefined' || job.jobId !== jobId) && Object.keys(this.previousJobs).length === 0) {
            return shareError([21, 'share error, server was restarted']);
        } else if ((typeof job === 'undefined' || job.jobId !== jobId) && (jobId in this.previousJobs)) {
            return shareError([21, 'share error, received new block']);
        } else if (typeof job === 'undefined' || job.jobId !== jobId) {
            return shareError([21, 'job not found']);
        }

        if (!job.registerSubmit(extraNonce1, extraNonce2, nTime, nonce)) {
            return shareError([22, 'duplicate share']);
        }

        let extraNonce1Buffer = new Buffer(extraNonce1, 'hex');
        let extraNonce2Buffer = new Buffer(extraNonce2, 'hex');
        let nonceSwap = Buffer.concat([extraNonce1Buffer, extraNonce2Buffer]);

        let headerBuffer = job.serializeCoinbase(extraNonce1Buffer, extraNonce2Buffer);
        nonceSwap.swap64();
        let headerHash = this.hashDigest_Mix(Buffer(job.rpcData.bits, 'hex'), Buffer(job.prevHashReversed, 'hex'), nonceSwap);
        let headerBigNum = bignum.fromBuffer(headerHash, {endian: 'big', size: 32});

        let blockHashInvalid = headerHash;
        let blockHash = headerHash;
        let blockHex = [nonce.toString('hex'), job.rpcData.bits, job.prevHashReversed];

        let shareDiff = diff1 / headerBigNum.toNumber() * this.shareMultiplier;

        let blockDiffAdjusted = job.difficulty * this.shareMultiplier;
        if (!job.target.ge(headerBigNum)) {
            if (this.options.emitInvalidBlockHashes)
                blockHashInvalid = util.reverseBuffer(util.sha256d(headerBuffer)).toString('hex');

            //Check if share didn't reached the miner's difficulty)
            if (shareDiff / difficulty < 0.99) {

                //Check if share matched a previous difficulty from before a vardiff retarget
                if (previousDifficulty && shareDiff >= previousDifficulty) {
                    difficulty = previousDifficulty;
                } else {
                    return shareError([23, 'low difficulty share of ' + shareDiff]);
                }

            }
        }


        this.emit('share', {
            job: jobId,
            ip: ipAddress,
            port: port,
            worker: workerName,
            height: job.rpcData.height,
            blockReward: job.rpcData.coinbasevalue,
            difficulty: difficulty,
            shareDiff: shareDiff.toFixed(8),
            blockDiff: blockDiffAdjusted,
            blockDiffActual: job.difficulty,
            blockHash: blockHash,
            blockHashInvalid: blockHashInvalid
        }, blockHex);

        return {result: true, error: null, blockHash: blockHash};
    };

    processStratumShare(jobId, previousDifficulty, difficulty, extraNonce1, extraNonce2, nTime, nonce, ipAddress, port, workerName) {
        const shareError = (error) => {
            this.emit('share', {
                job: jobId,
                ip: ipAddress,
                worker: workerName,
                difficulty: difficulty,
                error: error[1]
            });
            return {error: error, result: null};
        };

        if (extraNonce2.length / 2 !== this.extraNonce2Size)
            return shareError([20, 'incorrect size of extranonce2']);

        let job = this.validJobs[jobId];

        if ((typeof job === 'undefined' || job.jobId !== jobId) && Object.keys(this.previousJobs).length === 0) {
            return shareError([21, 'share error, server was restarted']);
        } else if ((typeof job === 'undefined' || job.jobId !== jobId) && (jobId in this.previousJobs)) {
            return shareError([21, 'share error, received new block']);
        } else if (typeof job === 'undefined' || job.jobId !== jobId) {
            return shareError([21, 'job not found']);
        }

        if (!job.registerSubmit(extraNonce1, extraNonce2, nTime, nonce)) {
            return shareError([22, 'duplicate share']);
        }

        let extraNonce1Buffer = new Buffer(extraNonce1, 'hex');
        let extraNonce2Buffer = new Buffer(extraNonce2, 'hex');
        let nonceSwap = Buffer.concat([extraNonce1Buffer, extraNonce2Buffer]);
        nonceSwap.swap64();
        let headerHash = this.hashDigest(Buffer(job.rpcData.seedhash, 'hex'), Buffer(job.rpcData.headerhash, 'hex'), nonceSwap);

        if (this.options.checkShare !== false) {
            let headerBuffer = job.serializeCoinbase(extraNonce1Buffer, extraNonce2Buffer);
            let coinbaseHash = this.hashDigest_mix(Buffer(job.rpcData.seedhash, 'hex'), Buffer(job.rpcData.headerhash, 'hex'), nonceSwap);
            let headerBigNum = bignum.fromBuffer(headerHash, {endian: 'big', size: 32});

            let shareDiff = diff1 / headerBigNum.toNumber() * this.shareMultiplier;
            let blockDiffAdjusted = job.difficulty * this.shareMultiplier;


            //Check if share is a block candidate (matched network difficulty)
            let blockHashInvalid;
            let blockHash;
            let blockHex;
            if (job.target.ge(headerBigNum)) {
                blockHashInvalid = headerHash;
                blockHash = headerHash;
                blockHex = [job.rpcData.jobid,
                    extraNonce1.substring(extraNonce1.length - 2, extraNonce1.length) + extraNonce2,
                    job.rpcData.headerhash,
                    job.rpcData.seedhash,
                    extraNonce1 + extraNonce2,
                    util.pad(coinbaseHash.toString('hex'), 64, 0),
                    workerName
                ];
            } else {
                if (this.options.emitInvalidBlockHashes)
                    blockHashInvalid = util.reverseBuffer(util.sha256d(headerBuffer)).toString('hex');
                //Check if share didn't reached the miner's difficulty)
                if (shareDiff / difficulty < 0.99) {
                    //Check if share matched a previous difficulty from before a vardiff retarget
                    if (previousDifficulty && shareDiff >= previousDifficulty) {
                        difficulty = previousDifficulty;
                    } else {
                        return shareError([23, 'low difficulty share of ' + shareDiff]);
                    }

                }
            }

            this.emit('share', {
                job: jobId,
                ip: ipAddress,
                port: port,
                worker: workerName,
                height: job.rpcData.height,
                blockReward: job.rpcData.coinbasevalue,
                difficulty: difficulty,
                shareDiff: shareDiff.toFixed(8),
                blockDiff: blockDiffAdjusted,
                blockDiffActual: job.difficulty,
                blockHash: blockHash,
                blockHashInvalid: blockHashInvalid
            }, blockHex);
        } else {
            this.emit('share', {
                job: jobId,
                ip: ipAddress,
                worker: workerName,
                difficulty: difficulty
            });
        }
        return {result: true, error: null, blockHash: headerHash};
    };
}

module.exports = JobManager;
JobManager.prototype.__proto__ = events.EventEmitter.prototype;
