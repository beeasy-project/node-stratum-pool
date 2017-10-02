var bignum = require('bignum');

var merkleTree = require('./merkleTree.js');
var transactions = require('./transactions.js');
var util = require('./util.js');


/**
 * The BlockTemplate class holds a single job.
 * and provides several methods to validate and submit it to the daemon coin
 **/
var BlockTemplate = module.exports = function BlockTemplate(jobId, rpcData ) {

    //private members

    var submits = [];



    //public members
    this.rpcData = rpcData;
    this.jobId = jobId;
/*    this.target = rpcData.target ?
     bignum(rpcData.target, 16) :
     util.bignumFromBitsHex(rpcData.bits);
     */


//    console.log('rpcData  ' + rpcData);
    this.target = bignum(rpcData.target, 16);
//    this.target = util.bignumFromBitsHex( rpcData.bits );


    this.difficulty = parseFloat(( diff1 / this.target.toNumber() ).toFixed(9));

    console.log('this.difficulty = ' + this.difficulty);
//    logger.debug(logSystem, logComponent, logSubCat, 'this.difficulty = ' + this.difficulty);

//    this.prevHash = new Buffer(this.headerhash, 'hex').toString('hex');

    this.seedhash = this.rpcData.seedhash;
    this.headerhash = this.rpcData.headerhash;
    this.previousHash = this.headerhash;

    this.serializeCoinbase = function (extraNonce1, extraNonce2) {
        return Buffer.concat([
            new Buffer(this.rpcData.seedhash, 'hex'),
            new Buffer(this.rpcData.headerhash, 'hex'),
            extraNonce1,
            extraNonce2
        ]);
    };






    this.registerSubmit = function (extraNonce1, extraNonce2, nTime, nonce) {
        var submission = extraNonce1 + extraNonce2 + nTime + nonce;
        if (submits.indexOf(submission) === -1) {
            submits.push(submission);
            return true;
        }
        return false;
    };


    this.getJobParams = function () {
        if (!this.jobParams) {
            this.jobParams = [
                this.jobId,
                this.seedhash,
                this.headerhash,
                true,
            ];
        }
        return this.jobParams;
    };
};
