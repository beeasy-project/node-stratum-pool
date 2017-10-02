var events = require('events');
var async = require('async');
var bignum = require('bignum');

var varDiff = require('./varDiff.js');
var daemon_v2 = require('./daemon_stratum.js');
var daemon_v1 = require('./daemon_stratum_v1.js')
var peer = require('./peer.js');
var stratum = require('./stratum.js');
var jobManager = require('./jobManager.js');
var util = require('./util.js');
var daemon;



/*process.on('uncaughtException', function(err) {
 console.log(err.stack);
 throw err;
 });*/

var pool = module.exports = function pool(options, authorizeFn) {

    this.options = options;

    if( options.daemons[0].type=="stratum_v1")
    {
        daemon = daemon_v1;
    }else{
        daemon = daemon_v2;
    }

    var _this = this;
    var blockPollingIntervalId;
    var diff = diff1;


    var emitLog = function (text) {
        _this.emit('log', 'debug', text);
    };
    var emitWarningLog = function (text) {
        _this.emit('log', 'warning', text);
    };
    var emitErrorLog = function (text) {
        _this.emit('log', 'error', text);
    };
    var emitSpecialLog = function (text) {
        _this.emit('log', 'special', text);
    };


//    var nanopoolApi =  new Nanopool();


    if (!(options.coin.algorithm in algos)) {
        emitErrorLog('The ' + options.coin.algorithm + ' hashing algorithm is not supported.');
        throw new Error();
    }


    this.start = function () {
        SetupVarDiff();
        SetupApi();

        SetupDaemonInterface(function () {
            DetectCoinData(function () {
                SetupRecipients();
                SetupJobManager();
                    OnBlockchainSynced(function () {
                    GetFirstJob(function () {
                        SetupBlockPolling();
                        SetupPeer();
                        StartStratumServer(function () {
                             OutputPoolInfo();
                            _this.emit('started');
                        });
                    });
                });
            });
        });
    };


    function GetFirstJob(finishedCallback) {

 /*       GetBlockTemplate(function (error, result) {
            if (error) {
                emitErrorLog('Error with getblocktemplate on creating first job, server cannot start');
                return;
            }
*/
/*                function sleep(milliSeconds) {
                    var startTime = new Date().getTime();
                    while (new Date().getTime() < startTime + milliSeconds);
                }

                sleep(5000);
*/
            var portWarnings = [];

            var networkDiffAdjusted = options.initStats.difficulty;

            Object.keys(options.ports).forEach(function (port) {
                var portDiff = options.ports[port].diff;
                if (networkDiffAdjusted < portDiff)
                    portWarnings.push('port ' + port + ' w/ diff ' + portDiff);
                if( options.ports[port].difftype == "external" && options.ports[port].diff != _this.jobManager.currentJob.difficulty ) {
                    options.ports[port].diff = _this.jobManager.currentJob.difficulty;
                    portWarnings.push('port ' + port + 'new external difficulty  ' + options.ports[port].diff);
                }
            });

            //Only let the first fork show synced status or the log will look flooded with it
            if (portWarnings.length > 0 && (!process.env.forkId || process.env.forkId === '0')) {
                var warnMessage = 'Network diff of ' + networkDiffAdjusted + ' is lower than '
                    + portWarnings.join(' and ');
                emitWarningLog(warnMessage);
            }





//            this.sendSubscribe();


            finishedCallback();

//        });
    }


    function OutputPoolInfo() {

        var startMessage = 'Stratum Pool Server Started for ' + options.coin.name +
            ' [' + options.coin.symbol.toUpperCase() + '] {' + options.coin.algorithm + '}';
        if (process.env.forkId && process.env.forkId !== '0') {
            emitLog(startMessage);
            return;
        }
        var infoLines = [startMessage,
            'Network Connected:\t' + (options.testnet ? 'Testnet' : 'Mainnet'),
            'Detected Reward Type:\t' + options.coin.reward,
            'Current Block Height:\t' + _this.jobManager.currentJob.rpcData.height,
            'Current Connect Peers:\t' + options.initStats.connections,
            'Current Block Diff:\t' + _this.jobManager.currentJob.difficulty * algos[options.coin.algorithm].multiplier,
            'Network Difficulty:\t' + options.initStats.difficulty,
            'Network Hash Rate:\t' + util.getReadableHashRateString(options.initStats.networkHashRate),
            'Stratum Port(s):\t' + _this.options.initStats.stratumPorts.join(', '),
            'Pool Fee Percent:\t' + _this.options.feePercent + '%'
        ];

        if (typeof options.blockRefreshInterval === "number" && options.blockRefreshInterval > 0)
            infoLines.push('Block polling every:\t' + options.blockRefreshInterval + ' ms');

        emitSpecialLog(infoLines.join('\n\t\t\t\t\t\t'));
    }


    function OnBlockchainSynced(syncedCallback) {

        var checkSynced = function (displayNotSynced) {
            var synced = false;
            if( _this.jobManager.currentJob != null ) {
                synced = true;
            }

            if (synced) {
                syncedCallback();
            }
            else {
                if (displayNotSynced) displayNotSynced();
                setTimeout(checkSynced, 5000);
            }

        };

        checkSynced(function () {
            //Only let the first fork show synced status or the log wil look flooded with it
            if (!process.env.forkId || process.env.forkId === '0')
                emitErrorLog('Stratum is not connnected');

        });
    };



    function SetupApi() {
        if (typeof(options.api) !== 'object' || typeof(options.api.start) !== 'function') {
            return;
        } else {
            options.api.start(_this);
        }
    }


    function SetupPeer() {
        if (!options.p2p || !options.p2p.enabled)
            return;

        if (options.testnet && !options.coin.peerMagicTestnet) {
            emitErrorLog('p2p cannot be enabled in testnet without peerMagicTestnet set in coin configuration');
            return;
        }
        else if (!options.coin.peerMagic) {
            emitErrorLog('p2p cannot be enabled without peerMagic set in coin configuration');
            return;
        }

        _this.peer = new peer(options);
        _this.peer.on('connected', function () {
            emitLog('p2p connection successful');
        }).on('connectionRejected', function () {
            emitErrorLog('p2p connection failed - likely incorrect p2p magic value');
        }).on('disconnected', function () {
            emitWarningLog('p2p peer node disconnected - attempting reconnection...');
        }).on('connectionFailed', function (e) {
            emitErrorLog('p2p connection failed - likely incorrect host or port');
        }).on('socketError', function (e) {
            emitErrorLog('p2p had a socket error ' + JSON.stringify(e));
        }).on('error', function (msg) {
            emitWarningLog('p2p had an error ' + msg);
        }).on('blockFound', function (hash) {
            _this.processBlockNotify(hash, 'p2p');
        });
    }


    function SetupVarDiff() {
        _this.varDiff = {};
        Object.keys(options.ports).forEach(function (port) {
            if (options.ports[port].varDiff)
                _this.setVarDiff(port, options.ports[port].varDiff);
        });
    }


    /*
     Coin daemons either use submitblock or getblocktemplate for submitting new blocks
     */
    function SubmitBlock(blockHex, callback) {
        var isaccepted = false;
        _this.daemon.submit( blockHex, function( command ) {
            console.log("Submit callback result " + command.result + " user " + " job " + "nonce "+ blockHex[0] );
            if( command.result == true  )
            {
                isaccepted = true;
            }
            callback( isaccepted, command.error );

        } );
    }


    function SetupRecipients() {
        var recipients = [];
        options.feePercent = 0;
        options.rewardRecipients = options.rewardRecipients || {};
        for (var r in options.rewardRecipients) {
            var percent = options.rewardRecipients[r];
            var rObj = {
                percent: percent / 100
            };
            try {
                if (r.length === 40)
                    rObj.script = util.miningKeyToScript(r);
                else
                    rObj.script = util.addressToScript(r);
                recipients.push(rObj);
                options.feePercent += percent;
            }
            catch (e) {
                emitErrorLog('Error generating transaction output script for ' + r + ' in rewardRecipients');
            }
        }
        if (recipients.length === 0) {
            emitErrorLog('No rewardRecipients have been setup which means no fees will be taken');
        }
        options.recipients = recipients;
    }

    function SetupJobManager() {

        _this.jobManager = new jobManager(options);

        _this.jobManager.on( 'newBlock', function( blockTemplate ) {
            //Check if stratumServer has been initialized yet
            if (_this.stratumServer) {
                _this.stratumServer.broadcastMiningJobs(blockTemplate.getJobParams());
            }

        }).on('updatedBlock', function (blockTemplate) {
            //Check if stratumServer has been initialized yet
            if (_this.stratumServer) {
                var job = blockTemplate.getJobParams();
//                job[8] = false;
                _this.stratumServer.broadcastMiningJobs(job);
            }


        }).on('share', function (shareData, blockHex) {
            var isValidShare = !shareData.error;
            var isValidBlock = !!blockHex;
            var emitShare = function ( ) {
                console.log("Share " + isValidShare);
                _this.emit('share', isValidShare, isValidBlock, false, shareData);
            };

            if (!isValidBlock)
                emitShare( );
            else {
                SubmitBlock(blockHex, function (isAccepted, ErrorCode) {
                    if( isAccepted == false ) isValidBlock = false;
                        emitShare( );
                });
            }
        }).on('log', function (severity, message) {
            _this.emit('log', severity, message);
        });
    }


    function SetupDaemonInterface(finishedCallback) {

        if (!Array.isArray(options.daemons) || options.daemons.length < 1) {
            emitErrorLog('No daemons have been configured - pool cannot start');
            return;
        }

        _this.daemon = new daemon.interface(options.daemons, function (severity, message) {
            _this.emit('log', severity, message);
        });

        _this.daemon.once('online', function () {
//            nanopoolApi.getBalance( function( error, result ) {
//                console.log( "balance = " + result.data );});
            finishedCallback();

        }).on('connectionFailed', function (error) {
            emitErrorLog('Failed to connect daemon(s): ' + JSON.stringify(error));

        }).on('error', function (message) {
            emitErrorLog(message);

        }).on('mining.notify', function (data) {
            var json_response = {
                seedhash: data[2],
                headerhash: data[1],
                target: util.pad( diff.toString(16), 64, 0),
                jobid : data[0],
                previousHash : data[1]

            };
            _this.processBlockNotify( data[1], 'stratum');

            var processedNewBlock = _this.jobManager.processTemplate(json_response);

            console.log("mining.notify id : " + data[0] + "   data : " +  data[1] + "  " + data[2] );



/*            _this.daemon.getbalance( function( bal ) {
                console.log("balance = " + bal );


            } );
*/



        }).on('mining.set_difficulty', function (data) {
            console.log("mining.set_difficulty : " + data[0] );
            var newdiff = diff1 / data[0];
            diff = newdiff;
            console.log("mining.set_difficulty     : " + util.pad( newdiff.toString(16), 64, 0) );
            _this.difficulty = data[0];
            if( _this.startumServer != null ) _this.stratumServer.broadcastDifficulty(data[0]);

        }).on('mining.set_extranonce', function (data) {
            console.log("mining.set_extranonce : " + data );

            _this.jobManager.extraNonceCounter.size = data.length / 2 + 1;
            _this.jobManager.extraNonceCounter.extra_counter = parseInt(data,16);
            _this.jobManager.extraNonce2Size = _this.jobManager.extraNoncePlaceholder.length - _this.jobManager.extraNonceCounter.size;

        });

        _this.daemon.init();
    }


    function DetectCoinData(finishedCallback) {

        var batchRpcCalls = [
//          ['validateaddress', [options.address]],
//          ['getdifficulty', []],
//          ['getinfo', []],
//          ['getmininginfo', []],
//          ['submitblock', []]
//          ['eth_submitLogin', [options.address]],//
            ['mining.subscribe', ["NOMP1.1","EtheriumStartum 1.0"]],

        ];


            options.coin.reward = 'POW';


            /* POS coins must use the pubkey in coinbase transaction, and pubkey is
             only given if address is owned by wallet.*/
            /*            if (options.coin.reward === 'POS' && typeof(rpcResults.validateaddress.pubkey) == 'undefined') {
             emitErrorLog('The address provided is not from the daemon wallet - this is required for POS coins.');
             return;
             }
             */
            console.log("Address " + options.address);

            options.testnet = 0;
            options.protocolVersion = 1.0;

            options.hasSubmitMethod = true;
            options.initStats = {
                connections: 1

            };
            finishedCallback();
    }


    function StartStratumServer(finishedCallback) {
        _this.stratumServer = new stratum.Server(options, authorizeFn);

        _this.stratumServer.on('started', function () {
            options.initStats.stratumPorts = Object.keys(options.ports);
            if( _this.jobManager.currentJob !== null && typeof _this.jobManager.currentJob != "undefined"){
                _this.stratumServer.broadcastMiningJobs(_this.jobManager.currentJob.getJobParams());}
            finishedCallback();

        }).on('broadcastTimeout', function () {
            emitLog('No new blocks for ' + options.jobRebroadcastTimeout + ' seconds - updating transactions & rebroadcasting work');

            GetBlockTemplate(function (error, rpcData, processedBlock) {
                if (error || processedBlock) return;
                _this.jobManager.updateCurrentJob(rpcData);
            });
        }).on('client.disconnected', function(client){
                _this.emit('client.disconnected', client)
        }).on('client.connected', function (client) {
            if (typeof(_this.varDiff[client.socket.localPort]) !== 'undefined') {
                _this.varDiff[client.socket.localPort].manageClient(client);
            }

            client.on('difficultyChanged', function (diff) {
                _this.emit('difficultyUpdate', client.workerName, diff);
            }).on('client.live',function(client){
                _this.emit('client.live', client);
            }).on('subscription', function (params, resultCallback) {

                var extraNonce = _this.jobManager.extraNonceCounter.next();
                var extraNonce2Size = _this.jobManager.extraNonce2Size;
                resultCallback(null,
                    extraNonce,
                    extraNonce2Size
                );


                if( typeof( options.ports[client.socket.localPort] ) !== 'undefined' && options.ports[client.socket.localPort].diff ) {
                    if( options.ports[client.socket.localPort].difftype === "external" ){
//                        console.log("!!! External Diff !!!");
                    }
                    else {
//                        console.log("!!! External Diff Wasn't Set !!!");
                    }

                    this.sendDifficulty(options.ports[client.socket.localPort].diff);
//                    this.sendDifficulty( 666 );
                }
                else {
                    this.sendDifficulty( 0.1 );
                }


                this.sendMiningJob(_this.jobManager.currentJob.getJobParams());

            }).on('submit', function (params, resultCallback) {
                ntime = new Date().getTime().toString(16);

                emitWarningLog('client.getLabel() = ' + client.getLabel() + "   params.name = " + params.name + "   params.extraNonce2 = " + params.extraNonce2 + " ntime = " + ntime);


                var result = _this.jobManager.processStratumShare(
                    params.jobId,
                    client.previousDifficulty,
                    client.difficulty,
                    client.extraNonce1,
                    params.extraNonce2,
                    ntime,
                    params.extraNonce2,
                    client.remoteAddress,
                    client.socket.localPort,
                    params.name
                );

                resultCallback(result.error, result.result ? true : null);


            }).on('malformedMessage', function (message) {
                emitWarningLog('Malformed message from ' + client.getLabel() + ': ' + message);

            }).on('socketError', function (err) {
                emitWarningLog('Socket error from ' + client.getLabel() + ': ' + JSON.stringify(err));

            }).on('socketTimeout', function (reason) {
                emitWarningLog('Connected timed out for ' + client.getLabel() + ': ' + reason)

            }).on('socketDisconnect', function () {
                //emitLog('Socket disconnected from ' + client.getLabel());

            }).on('kickedBannedIP', function (remainingBanTime) {
                emitLog('Rejected incoming connection from ' + client.remoteAddress + ' banned for ' + remainingBanTime + ' more seconds');

            }).on('forgaveBannedIP', function () {
                emitLog('Forgave banned IP ' + client.remoteAddress);

            }).on('unknownStratumMethod', function (fullMessage) {
                emitLog('Unknown stratum method from ' + client.getLabel() + ': ' + fullMessage.method);

            }).on('socketFlooded', function () {
                emitWarningLog('Detected socket flooding from ' + client.getLabel());

            }).on('tcpProxyError', function (data) {
                emitErrorLog('Client IP detection failed, tcpProxyProtocol is enabled yet did not receive proxy protocol message, instead got data: ' + data);

            }).on('bootedBannedWorker', function () {
                emitWarningLog('Booted worker ' + client.getLabel() + ' who was connected from an IP address that was just banned');

            }).on('triggerBan', function (reason) {
                emitWarningLog('Banned triggered for ' + client.getLabel() + ': ' + reason);
                _this.emit('banIP', client.remoteAddress, client.workerName);
            });
        });
    }


    function SetupBlockPolling() {
        if (typeof options.blockRefreshInterval !== "number" || options.blockRefreshInterval <= 0) {
            emitLog('Block template polling has been disabled');
            return;
        }

        var pollingInterval = options.blockRefreshInterval;

        blockPollingIntervalId = setInterval(function () {
            GetBlockTemplate(function (error, result, foundNewBlock) {
                if (foundNewBlock)
                    emitLog('Block notification via RPC polling');
            });
        }, pollingInterval);
    }


// Replaced
    /*    function GetBlockTemplate(callback) {
     _this.daemon.cmd('getblocktemplate',
     [{"capabilities": ["coinbasetxn", "workid", "coinbase/append"], "rules": ["segwit"]}],
     function (result) {
     if (result.error) {
     emitErrorLog('getblocktemplate call failed for daemon instance ' +
     result.instance.index + ' with error ' + JSON.stringify(result.error));
     callback(result.error);
     } else {
     var processedNewBlock = _this.jobManager.processTemplate(result.response);
     callback(null, result.response, processedNewBlock);
     callback = function () {
     };
     }
     }, true
     );
     }
     */

    function GetBlockTemplate(callback) {
/*        _this.daemon.cmd('eth_getWork', [],
            function (result) {
                if (result.error) {
                    emitErrorLog('eth_getWork  call failed for daemon instance ' +
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



                    var processedNewBlock = _this.jobManager.processTemplate(json_response);
                    callback(null, json_response, processedNewBlock);
                    callback = function () {
                    };
                }
            }, true
        );
*/
        var json_response = { };
        callback(null, json_response, true);
    }


    function CheckBlockAccepted(blockHash, callback) {
        //setTimeout(function(){
        _this.daemon.cmd('getblock',
            [blockHash],
            function (results) {
                var validResults = results.filter(function (result) {
                    return result.response && (result.response.hash === blockHash)
                });

                if (validResults.length >= 1) {
                    callback(true, validResults[0].response.tx[0]);
                }
                else {
                    callback(false);
                }
            }
        );
        //}, 500);
    }


    /**
     * This method is being called from the blockNotify so that when a new block is discovered by the daemon
     * We can inform our miners about the newly found block
     **/
    this.processBlockNotify = function (blockHash, sourceTrigger) {
        emitLog('Block notification via ' + sourceTrigger);
        if (typeof(_this.jobManager.currentJob) !== 'undefined' && blockHash !== _this.jobManager.currentJob.rpcData.previousHash) {
            GetBlockTemplate(function (error, result) {
                if (error)
                    emitErrorLog('Block notify error getting block template for ' + options.coin.name);
            })
        }
    };


    this.relinquishMiners = function (filterFn, resultCback) {
        var origStratumClients = this.stratumServer.getStratumClients();

        var stratumClients = [];
        Object.keys(origStratumClients).forEach(function (subId) {
            stratumClients.push({subId: subId, client: origStratumClients[subId]});
        });
        async.filter(
            stratumClients,
            filterFn,
            function (clientsToRelinquish) {
                clientsToRelinquish.forEach(function (cObj) {
                    cObj.client.removeAllListeners();
                    _this.stratumServer.removeStratumClientBySubId(cObj.subId);
                });

                process.nextTick(function () {
                    resultCback(
                        clientsToRelinquish.map(
                            function (item) {
                                return item.client;
                            }
                        )
                    );
                });
            }
        )
    };


    this.attachMiners = function (miners) {
        miners.forEach(function (clientObj) {
            _this.stratumServer.manuallyAddStratumClient(clientObj);
        });
        _this.stratumServer.broadcastMiningJobs(_this.jobManager.currentJob.getJobParams());

    };


    this.getStratumServer = function () {
        return _this.stratumServer;
    };


    this.setVarDiff = function (port, varDiffConfig) {
        if (typeof(_this.varDiff[port]) != 'undefined') {
            _this.varDiff[port].removeAllListeners();
        }
        var varDiffInstance = new varDiff(port, varDiffConfig);
        _this.varDiff[port] = varDiffInstance;
        _this.varDiff[port].on('newDifficulty', function (client, newDiff) {

            /* We request to set the newDiff @ the next difficulty retarget
             (which should happen when a new job comes in - AKA BLOCK) */
            client.enqueueNextDifficulty(newDiff);

            /*if (options.varDiff.mode === 'fast'){
             //Send new difficulty, then force miner to use new diff by resending the
             //current job parameters but with the "clean jobs" flag set to false
             //so the miner doesn't restart work and submit duplicate shares
             client.sendDifficulty(newDiff);
             var job = _this.jobManager.currentJob.getJobParams();
             job[8] = false;
             client.sendMiningJob(job);
             }*/

        });
    };



};
pool.prototype.__proto__ = events.EventEmitter.prototype;
