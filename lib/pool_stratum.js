const events = require('events');
const async = require('async');
const bignum = require('bignum');

const varDiff = require('./varDiff.js');
const daemon_v2 = require('./daemon_stratum.js');
const daemon_v1 = require('./daemon_stratum_v1.js');
const peer = require('./peer.js');
const stratum = require('./stratum.js');
const JobManager = require('./jobManager.js');
const util = require('./util.js');
let daemon;


/*process.on('uncaughtException', function(err) {
 console.log(err.stack);
 throw err;
 });*/
class Pool {
    constructor(options, authorizeFn) {
        this.options = options;

        if (options.daemons[0].type === "stratum_v1") {
            daemon = daemon_v1;
        } else {
            daemon = daemon_v2;
        }

        this.authorizeFn = authorizeFn;
        this.blockPollingIntervalId = undefined;
        this.diff = diff1;
        if (!(this.options.coin.algorithm in algos)) {
            this.emitErrorLog('The ' + this.options.coin.algorithm + ' hashing algorithm is not supported.');
            throw new Error();
        }
    }

    emitLog(text) {
        this.emit('log', 'debug', text);
    };

    emitWarningLog(text) {
        this.emit('log', 'warning', text);
    };

    emitErrorLog(text) {
        this.emit('log', 'error', text);
    };

    emitSpecialLog(text) {
        this.emit('log', 'special', text);
    };

//    var nanopoolApi =  new Nanopool();

    start() {
        this.SetupVarDiff();
        this.SetupApi();

        this.SetupDaemonInterface(() => {
            this.DetectCoinData(() => {
                this.SetupRecipients();
                this.SetupJobManager();
                this.OnBlockchainSynced(() => {
                    this.GetFirstJob(() => {
                        this.SetupBlockPolling();
                        this.SetupPeer();
                        this.StartStratumServer(() => {
                            this.OutputPoolInfo();
                            this.emit('started');
                        });
                    });
                });
            });
        });
    };

    GetFirstJob(finishedCallback) {
        /*       GetBlockTemplate(function (error, result) {
         if (error) {
         this.emitErrorLog('Error with getblocktemplate on creating first job, server cannot start');
         return;
         }
         */
        /*                function sleep(milliSeconds) {
         var startTime = new Date().getTime();
         while (new Date().getTime() < startTime + milliSeconds);
         }

         sleep(5000);
         */
        let portWarnings = [];
        let networkDiffAdjusted = this.options.initStats.difficulty;
        Object.keys(this.options.ports).forEach((port) => {
            let portDiff = this.options.ports[port].diff;
            if (networkDiffAdjusted < portDiff)
                portWarnings.push('port ' + port + ' w/ diff ' + portDiff);
            if (this.options.ports[port].difftype === "external" && this.options.ports[port].diff !== this.jobManager.currentJob.difficulty) {
                this.options.ports[port].diff = this.jobManager.currentJob.difficulty;
                portWarnings.push('port ' + port + 'new external difficulty  ' + this.options.ports[port].diff);
            }
        });

        //Only let the first fork show synced status or the log will look flooded with it
        if (portWarnings.length > 0 && (!process.env.forkId || process.env.forkId === '0')) {
            let warnMessage = 'Network diff of ' + networkDiffAdjusted + ' is lower than '
                + portWarnings.join(' and ');
            this.emitWarningLog(warnMessage);
        }
//            this.sendSubscribe();
        finishedCallback();
//        });
    };

    OutputPoolInfo() {
        let startMessage = 'Stratum Pool Server Started for ' + this.options.coin.name +
            ' [' + this.options.coin.symbol.toUpperCase() + '] {' + this.options.coin.algorithm + '}';
        if (process.env.forkId && process.env.forkId !== '0') {
            this.emitLog(startMessage);
            return;
        }
        let infoLines = [startMessage,
            'Network Connected:\t' + (this.options.testnet ? 'Testnet' : 'Mainnet'),
            'Detected Reward Type:\t' + this.options.coin.reward,
            'Current Block Height:\t' + this.jobManager.currentJob.rpcData.height,
            'Current Connect Peers:\t' + this.options.initStats.connections,
            'Current Block Diff:\t' + this.jobManager.currentJob.difficulty * algos[this.options.coin.algorithm].multiplier,
            'Network Difficulty:\t' + this.options.initStats.difficulty,
            'Network Hash Rate:\t' + util.getReadableHashRateString(this.options.initStats.networkHashRate),
            'Stratum Port(s):\t' + this.options.initStats.stratumPorts.join(', '),
            'Pool Fee Percent:\t' + this.options.feePercent + '%'
        ];

        if (typeof this.options.blockRefreshInterval === "number" && this.options.blockRefreshInterval > 0)
            infoLines.push('Block polling every:\t' + this.options.blockRefreshInterval + ' ms');

        this.emitSpecialLog(infoLines.join('\n\t\t\t\t\t\t'));
    };

    OnBlockchainSynced(syncedCallback) {
        let checkSynced = (displayNotSynced) => {
            let synced = false;
            if (this.jobManager.currentJob !== undefined) {
                synced = true;
            }

            if (synced) {
                syncedCallback();
            } else {
                if (displayNotSynced) displayNotSynced();
                setTimeout(checkSynced, 5000);
            }

        };

        checkSynced(() => {
            //Only let the first fork show synced status or the log wil look flooded with it
            if (!process.env.forkId || process.env.forkId === '0')
                this.emitErrorLog('Stratum is not connnected');

        });
    };

    SetupApi() {
        if (typeof this.options.api !== 'undefined' && (typeof this.options.api === 'object' || typeof this.options.api.start === 'function')) {
            this.options.api.start(this);
        }
    };

    SetupPeer() {
        if (!this.options.p2p || !this.options.p2p.enabled)
            return;

        if (this.options.testnet && !this.options.coin.peerMagicTestnet) {
            this.emitErrorLog('p2p cannot be enabled in testnet without peerMagicTestnet set in coin configuration');
            return;
        } else if (!this.options.coin.peerMagic) {
            this.emitErrorLog('p2p cannot be enabled without peerMagic set in coin configuration');
            return;
        }

        this.peer = new peer(this.options);
        this.peer.on('connected', () => {
            this.emitLog('p2p connection successful');
        }).on('connectionRejected', () => {
            this.emitErrorLog('p2p connection failed - likely incorrect p2p magic value');
        }).on('disconnected', () => {
            this.emitWarningLog('p2p peer node disconnected - attempting reconnection...');
        }).on('connectionFailed', (ignore) => {
            this.emitErrorLog('p2p connection failed - likely incorrect host or port');
        }).on('socketError', (e) => {
            this.emitErrorLog('p2p had a socket error ' + JSON.stringify(e));
        }).on('error', (msg) => {
            this.emitWarningLog('p2p had an error ' + msg);
        }).on('blockFound', (hash) => {
            this.processBlockNotify(hash, 'p2p');
        });
    };

    SetupVarDiff() {
        this.varDiff = {};
        Object.keys(this.options.ports).forEach((port) => {
            if (this.options.ports[port].varDiff)
                this.setVarDiff(port, this.options.ports[port].varDiff);
        });
    };

    /*
     Coin daemons either use submitblock or getblocktemplate for submitting new blocks
     */
    SubmitBlock(blockHex, callback) {
        let isAccepted = false;
        this.daemon.submit(blockHex, (command) => {
            console.log("Submit callback result " + command.result + " user " + " job " + "nonce " + blockHex[0]);
            if (command.result === true) {
                isAccepted = true;
            }
            callback(isAccepted, command.error);
        });
    };

    SetupRecipients() {
        let recipients = [];
        this.options.feePercent = 0;
        this.options.rewardRecipients = this.options.rewardRecipients || {};
        for (let rewardRecipient in this.options.rewardRecipients) {
            if (this.options.rewardRecipients.hasOwnProperty(rewardRecipient)) {
                let percent = this.options.rewardRecipients[rewardRecipient];
                let rObj = {
                    percent: percent / 100
                };
                try {
                    if (rewardRecipient.length === 40)
                        rObj.script = util.miningKeyToScript(rewardRecipient);
                    else
                        rObj.script = util.addressToScript(rewardRecipient);
                    recipients.push(rObj);
                    this.options.feePercent += percent;
                }
                catch (e) {
                    this.emitErrorLog('Error generating transaction output script for ' + rewardRecipient + ' in rewardRecipients');
                }
            }
        }
        if (recipients.length === 0) {
            this.emitErrorLog('No rewardRecipients have been setup which means no fees will be taken');
        }
        this.options.recipients = recipients;
    };

    SetupJobManager() {
        this.jobManager = new JobManager(this.options);
        this.jobManager.on('newBlock', (blockTemplate) => {
            //Check if stratumServer has been initialized yet
            if (this.stratumServer) {
                this.stratumServer.broadcastMiningJobs(blockTemplate.getJobParams());
            }
        }).on('updatedBlock', (blockTemplate) => {
            //Check if stratumServer has been initialized yet
            if (this.stratumServer) {
                let job = blockTemplate.getJobParams();
//                job[8] = false;
                this.stratumServer.broadcastMiningJobs(job);
            }
        }).on('share', (shareData, blockHex) => {
            let isValidShare = !shareData.error;
            let isValidBlock = !!blockHex;
            let emitShare = () => {
                console.log("Share " + isValidShare);
                this.emit('share', isValidShare, isValidBlock, false, shareData);
            };
            if (!isValidBlock)
                emitShare();
            else {
                this.SubmitBlock(blockHex, (isAccepted, ignore) => {
                    if (isAccepted === false) isValidBlock = false;
                    emitShare();
                });
            }
        }).on('log', (severity, message) => {
            this.emit('log', severity, message);
        });
    };

    SetupDaemonInterface(finishedCallback) {
        if (!Array.isArray(this.options.daemons) || this.options.daemons.length < 1) {
            this.emitErrorLog('No daemons have been configured - pool cannot start');
            return;
        }
        this.daemon = new daemon.interface(this.options.daemons, (severity, message) => {
            this.emit('log', severity, message);
        });
        this.daemon.once('online', () => {
//            nanopoolApi.getBalance( function( error, result ) {
//                console.log( "balance = " + result.data );});
            finishedCallback();
        }).on('connectionFailed', (error) => {
            this.emitErrorLog('Failed to connect daemon(s): ' + JSON.stringify(error));
        }).on('error', (message) => {
            this.emitErrorLog(message);
        }).on('mining.notify', (data) => {
            let json_response = {
                seedhash: data[2],
                headerhash: data[1],
                target: util.pad(this.diff.toString(16), 64, 0),
                jobid: data[0],
                previousHash: data[1]
            };
            this.processBlockNotify(data[1], 'stratum');
            this.jobManager.processTemplate(json_response);
            console.log("mining.notify id : " + data[0] + "   data : " + data[1] + "  " + data[2]);
            /*            this.daemon.getbalance( function( bal ) {
             console.log("balance = " + bal );
             } );
             */
        }).on('mining.set_difficulty', (data) => {
            console.log("mining.set_difficulty : " + data[0]);
            let newDiff = diff1 / data[0];
            this.diff = newDiff;
            console.log("mining.set_difficulty     : " + util.pad(newDiff.toString(16), 64, 0));
            this.difficulty = data[0];
            if (typeof this.startumServer !== "undefined") this.stratumServer.broadcastDifficulty(data[0]);
        }).on('mining.set_extranonce', (data) => {
            console.log("mining.set_extranonce : " + data);
            this.jobManager.extraNonceCounter.size = data.length / 2 + 1;
            this.jobManager.extraNonceCounter.extra_counter = parseInt(data, 16);
            this.jobManager.extraNonce2Size = this.jobManager.extraNoncePlaceholder.length - this.jobManager.extraNonceCounter.size;
        });
        this.daemon.init();
    };

    DetectCoinData(finishedCallback) {
        // let batchRpcCalls = [
//          ['validateaddress', [options.address]],
//          ['getdifficulty', []],
//          ['getinfo', []],
//          ['getmininginfo', []],
//          ['submitblock', []]
//          ['eth_submitLogin', [options.address]],//
//             ['mining.subscribe', ["NOMP1.1", "EtheriumStartum 1.0"]],
        // ];
        this.options.coin.reward = 'POW';
        /* POS coins must use the pubkey in coinbase transaction, and pubkey is
         only given if address is owned by wallet.*/
        /*            if (options.coin.reward === 'POS' && typeof(rpcResults.validateaddress.pubkey) == 'undefined') {
         this.emitErrorLog('The address provided is not from the daemon wallet - this is required for POS coins.');
         return;
         }
         */
        console.log("Address " + this.options.address);

        this.options.testnet = 0;
        this.options.protocolVersion = 1.0;

        this.options.hasSubmitMethod = true;
        this.options.initStats = {
            connections: 1
        };
        finishedCallback();
    };

    StartStratumServer(finishedCallback) {
        this.stratumServer = new stratum.Server(this.options, this.authorizeFn);
        this.stratumServer.on('started', () => {
            this.options.initStats.stratumPorts = Object.keys(this.options.ports);
            if (this.jobManager.currentJob !== null && typeof this.jobManager.currentJob !== "undefined") {
                this.stratumServer.broadcastMiningJobs(this.jobManager.currentJob.getJobParams());
            }
            finishedCallback();
        }).on('broadcastTimeout', () => {
            this.emitLog('No new blocks for ' + this.options.jobRebroadcastTimeout + ' seconds - updating transactions & rebroadcasting work');
            Pool.GetBlockTemplate((error, rpcData, processedBlock) => {
                if (error || processedBlock) return;
                this.jobManager.updateCurrentJob(rpcData);
            });
        }).on('client.disconnected', (client) => {
            this.emit('client.disconnected', client)
        }).on('client.connected', (client) => {
            if (typeof(this.varDiff[client.socket.localPort]) !== 'undefined') {
                this.varDiff[client.socket.localPort].manageClient(client);
            }
            client.on('difficultyChanged', (diff) => {
                this.emit('difficultyUpdate', client.workerName, diff);
            }).on('client.live', (client) => {
                this.emit('client.live', client);
            }).on('subscription', (params, resultCallback) => {
                let extraNonce = this.jobManager.extraNonceCounter.next();
                let extraNonce2Size = this.jobManager.extraNonce2Size;
                resultCallback(null,
                    extraNonce,
                    extraNonce2Size
                );
                if (typeof( this.options.ports[client.socket.localPort] ) !== 'undefined' && this.options.ports[client.socket.localPort].diff) {
                    if (this.options.ports[client.socket.localPort].difftype === "external") {
//                        console.log("!!! External Diff !!!");
                    } else {
//                        console.log("!!! External Diff Wasn't Set !!!");
                    }
                    client.sendDifficulty(this.options.ports[client.socket.localPort].diff);
//                    this.sendDifficulty( 666 );
                } else {
                    client.sendDifficulty(0.1);
                }
                client.sendMiningJob(this.jobManager.currentJob.getJobParams());
            }).on('submit', (params, resultCallback) => {
                let nTime = new Date().getTime().toString(16);
                this.emitWarningLog('client.getLabel() = ' + client.getLabel() + "   params.name = " + params.name + "   params.extraNonce2 = " + params.extraNonce2 + " ntime = " + nTime);
                let result = this.jobManager.processStratumShare(
                    params.jobId,
                    client.previousDifficulty,
                    client.difficulty,
                    client.extraNonce1,
                    params.extraNonce2,
                    nTime,
                    params.extraNonce2,
                    client.remoteAddress,
                    client.socket.localPort,
                    params.name
                );
                resultCallback(result.error, result.result ? true : null);
            }).on('malformedMessage', (message) => {
                this.emitWarningLog('Malformed message from ' + client.getLabel() + ': ' + message);
            }).on('socketError', (err) => {
                this.emitWarningLog('Socket error from ' + client.getLabel() + ': ' + JSON.stringify(err));
            }).on('socketTimeout', (reason) => {
                this.emitWarningLog('Connected timed out for ' + client.getLabel() + ': ' + reason)
            }).on('socketDisconnect', () => {
                //this.emitLog('Socket disconnected from ' + client.getLabel());
            }).on('kickedBannedIP', (remainingBanTime) => {
                this.emitLog('Rejected incoming connection from ' + client.remoteAddress + ' banned for ' + remainingBanTime + ' more seconds');
            }).on('forgaveBannedIP', () => {
                this.emitLog('Forgave banned IP ' + client.remoteAddress);
            }).on('unknownStratumMethod', (fullMessage) => {
                this.emitLog('Unknown stratum method from ' + client.getLabel() + ': ' + fullMessage.method);
            }).on('socketFlooded', () => {
                this.emitWarningLog('Detected socket flooding from ' + client.getLabel());
            }).on('tcpProxyError', (data) => {
                this.emitErrorLog('Client IP detection failed, tcpProxyProtocol is enabled yet did not receive proxy protocol message, instead got data: ' + data);
            }).on('bootedBannedWorker', () => {
                this.emitWarningLog('Booted worker ' + client.getLabel() + ' who was connected from an IP address that was just banned');
            }).on('triggerBan', (reason) => {
                this.emitWarningLog('Banned triggered for ' + client.getLabel() + ': ' + reason);
                this.emit('banIP', client.remoteAddress, client.workerName);
            });
        });
    };

    SetupBlockPolling() {
        if (typeof this.options.blockRefreshInterval !== "number" || this.options.blockRefreshInterval <= 0) {
            this.emitLog('Block template polling has been disabled');
            return;
        }
        let pollingInterval = this.options.blockRefreshInterval;
        this.blockPollingIntervalId = setInterval(() => {
            Pool.GetBlockTemplate((error, result, foundNewBlock) => {
                if (foundNewBlock)
                    this.emitLog('Block notification via RPC polling');
            });
        }, pollingInterval);
    };

// Replaced
    /*    function GetBlockTemplate(callback) {
     this.daemon.cmd('getblocktemplate',
     [{"capabilities": ["coinbasetxn", "workid", "coinbase/append"], "rules": ["segwit"]}],
     function (result) {
     if (result.error) {
     this.emitErrorLog('getblocktemplate call failed for daemon instance ' +
     result.instance.index + ' with error ' + JSON.stringify(result.error));
     callback(result.error);
     } else {
     var processedNewBlock = this.jobManager.processTemplate(result.response);
     callback(null, result.response, processedNewBlock);
     callback = function () {
     };
     }
     }, true
     );
     }
     */

    static GetBlockTemplate(callback) {
        /*        this.daemon.cmd('eth_getWork', [],
         function (result) {
         if (result.error) {
         this.emitErrorLog('eth_getWork  call failed for daemon instance ' +
         result.instance.index + ' with error ' + JSON.stringify(result.error));
         callback(result.error);
         } else {
         var json_response = {
         prevHash: result.response[0].substr(2),
         bits: result.response[1].substr(2),
         target: result.response[2].substr(2),
         };
         console.log(
         "GetBlockTemplate : json_response = " + JSON.stringify(json_response, null, '\t')
         );
         var processedNewBlock = this.jobManager.processTemplate(json_response);
         callback(null, json_response, processedNewBlock);
         callback = function () {
         };
         }
         }, true
         );
         */
        let json_response = {};
        callback(null, json_response, true);
    };

    CheckBlockAccepted(blockHash, callback) {
        //setTimeout(function(){
        this.daemon.cmd('getblock',
            [blockHash],
            (results) => {
                let validResults = results.filter((result) => {
                    return result.response && (result.response.hash === blockHash)
                });
                if (validResults.length >= 1) {
                    callback(true, validResults[0].response.tx[0]);
                } else {
                    callback(false);
                }
            }
        );
        //}, 500);
    };

    /**
     * This method is being called from the blockNotify so that when a new block is discovered by the daemon
     * We can inform our miners about the newly found block
     **/
    processBlockNotify(blockHash, sourceTrigger) {
        this.emitLog('Block notification via ' + sourceTrigger);
        if (typeof this.jobManager.currentJob !== 'undefined' && blockHash !== this.jobManager.currentJob.rpcData.previousHash) {
            Pool.GetBlockTemplate((error, ignore) => {
                if (error)
                    this.emitErrorLog('Block notify error getting block template for ' + this.options.coin.name);
            })
        }
    };

    relinquishMiners(filterFn, resultCback) {
        let origStratumClients = this.stratumServer.getStratumClients();
        let stratumClients = [];
        Object.keys(origStratumClients).forEach((subId) => {
            stratumClients.push({subId: subId, client: origStratumClients[subId]});
        });
        async.filter(
            stratumClients,
            filterFn,
            (clientsToRelinquish) => {
                clientsToRelinquish.forEach((cObj) => {
                    cObj.client.removeAllListeners();
                    this.stratumServer.removeStratumClientBySubId(cObj.subId);
                });

                process.nextTick(() => {
                    resultCback(
                        clientsToRelinquish.map(
                            (item) => {
                                return item.client;
                            }
                        )
                    );
                });
            }
        )
    };

    attachMiners(miners) {
        miners.forEach((clientObj) => {
            this.stratumServer.manuallyAddStratumClient(clientObj);
        });
        this.stratumServer.broadcastMiningJobs(this.jobManager.currentJob.getJobParams());
    };

    getStratumServer() {
        return this.stratumServer;
    };

    setVarDiff(port, varDiffConfig) {
        if (typeof this.varDiff[port] !== 'undefined') {
            this.varDiff[port].removeAllListeners();
        }
        // let varDiffInstance = new varDiff(port, varDiffConfig);
        this.varDiff[port] = new varDiff(port, varDiffConfig);
        this.varDiff[port].on('newDifficulty', (client, newDiff) => {
            /* We request to set the newDiff @ the next difficulty retarget
             (which should happen when a new job comes in - AKA BLOCK) */
            client.enqueueNextDifficulty(newDiff);
            /*if (options.varDiff.mode === 'fast'){
             //Send new difficulty, then force miner to use new diff by resending the
             //current job parameters but with the "clean jobs" flag set to false
             //so the miner doesn't restart work and submit duplicate shares
             client.sendDifficulty(newDiff);
             var job = this.jobManager.currentJob.getJobParams();
             job[8] = false;
             client.sendMiningJob(job);
             }*/
        });
    };
}

Pool.prototype.__proto__ = events.EventEmitter.prototype;
module.exports = Pool;