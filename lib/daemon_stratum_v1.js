var net = require('net');
var crypto = require('crypto');
var events = require('events');

var util = require('./util.js');
var bignum = require('bignum');
//var poolapi = require('./apiNanopool.js');

function DaemonInterface(daemons, logger) {

    var _this = this;
    var socket;

    logger = logger || function (severity, message) {
            console.log(severity + ': ' + message);
        };

    function init() {
        Connect();
        isOnline(function (online) {
            if (online)
                _this.emit('online');
        });
    };

    function isOnline(callback) {
/*        cmd('getinfo', [], function (results) {
            var allOnline = results.every(function (result) {
                return !results.error;
            });
            callback(allOnline);
            if (!allOnline)
                _this.emit('connectionFailed', results);
        });*/
    }




    function Connect() {
        var dataBuffer = '';

        socket = net.connect({
            host: daemons[0].host,
            port: daemons[0].port
        }, function () {
            SendSubscribe( function(params) {
                console.log("SendSubscribe callback");
            });
            SendAuthorize(function(params){
                console.log("SendAuthorize callback");
            });

        });
        socket.on('close', function () {
            _this.emit('disconnected');
            Connect();
        });
        socket.on('error', function (e) {
            if (e.code === 'ECONNREFUSED') {
                validConnectionConfig = false;
                _this.emit('connectionFailed');
            }
            else
                _this.emit('socketError', e);
        });
        socket.on('data', function (d) {
            dataBuffer += d;
            if (Buffer.byteLength(dataBuffer, 'utf8') > 10240) { //10KB
                dataBuffer = '';
                _this.emit('socketFlooded');
                socket.destroy();
                return;
            }
            if (dataBuffer.indexOf('\n') !== -1) {
                var messages = dataBuffer.split('\n');
                var incomplete = dataBuffer.slice(-1) === '\n' ? '' : messages.pop();
                messages.forEach(function (message) {
                    if (message === '') return;
                    var messageJson;
                    try {
                        messageJson = JSON.parse(message);
                    } catch (e) {
                        if (options.tcpProxyProtocol !== true || d.indexOf('PROXY') !== 0) {
                            _this.emit('malformedMessage', message);
                            socket.destroy();
                        }
                        return;
                    }
                    if (messageJson) {
                        handleMessage(messageJson);
                    }
                });
                dataBuffer = incomplete;
            }
        });
    }


    function handleMessage(command) {
        console.log("Command received : " + JSON.stringify(command));

        if( command.jsonrpc !== null ) {
            console.log("Stratum Proxy Mode");
            if (!!command.id) {
                switch( command.id ) {
                    case 1:
                        console.log("Mining.subscribe response" + JSON.stringify((command)));
                        _this.emit("online");
                        _this.emit("mining.set_extranonce", "F234");
                        break;
                    case 2:
                        console.log("Mining.authorize response" + JSON.stringify((command)));
                        break;
                    case 3:
                        console.log("Mining.submit response" + JSON.stringify((command)));
                        break;
                    default:
                        console.log("Mining.notify response" + JSON.stringify((command)));
                        var targetBuffer = new Buffer(command.params[3],"hex");
                        var targetBigNum = bignum.fromBuffer(targetBuffer, {endian: 'big', size: 32});
                        var shareDiff = diff1 / targetBigNum.toNumber();

                        _this.emit("mining.set_difficulty", [shareDiff]);

                        var blockparams = [command.params[0],command.params[1], command.params[2]];
                        _this.emit("mining.notify", blockparams);

                }
            }
        }else {
            if (!!command.id) {
                switch (commands_array[command.id][0]) {
                    case "mining.submit":
                        commands_array[command.id][1](command);
                        break;

                    case "mining.subscribe":
                        _this.emit("online");
                        console.log("Stratum Etherium mode");
                        _this.emit("mining.set_extranonce", command.result[1]);

                        commands_array[command.id][1](command);
                        console.log(JSON.stringify(command));
                        if (command.error === null) {
                            this.online = 1;
                            console.log("Extranonce : " + command.result[1]);
                        }
                        else {
                            console.log("Subscription error");
                            this.online = 0;
                        }
                        commands_array[command.id][1]();
                        break;

                    case "mining.authorize":
                        break;
                }
                delete commands_array[command.id];
            }
            else {
                switch (command.method) {
                    case "mining.notify" :
                        _this.emit("mining.notify", [command.params[0], command.params[1], command.params[2]])
                        break;

                    case "mining.set_difficulty" :
                        _this.emit("mining.set_difficulty", command.params)
                        break;

                    case "mining.set_extranonce" :
                        _this.emit("mining.set_extranonce", command.params)
                        break;

                    default :
                }
            }
        }
    }

    function SendSubscribe( callback, params ) {
        console.log("!!! SendSubscribe() !!!");

        sendJson({
            id: 1,
            method: "mining.subscribe",
            params: [
                'NOMP/1.0.0',
                'EthereumStratum/1.0.0',
            ],
        });
    }

//    var poolOptions = poolConfigs[coin];

    function SendAuthorize( callback, params ) {
        console.log("!!! SendAuthorize() !!!");

        sendJson({
            id: 2,
            method: "mining.authorize",
            params: [
                daemons[0].user,
                daemons[0].password
            ],
        });
    }


    function SendSubmit(  params, callback ) {
        console.log("!!! SendSubmit() !!!");

        sendJson({
            id: 3,
            method: "mining.submit",
            params: [
                daemons[0].user,     // User
                daemons[0].password, // Password
                "0x" + params[4],    // Nonce
                "0x" + params[2],    // Headerhash
                "0x" + params[5]     // Mixhash
            ],
        });
        callback({result:true});

    }


    function sendJson() {
        var response = '';
        for (var i = 0; i < arguments.length; i++) {
            response += JSON.stringify(arguments[i]) + '\n';
        }
        socket.write(response);
    }


    function batchCmd(cmdArray, callback) {

        var requestJson = [];

        for (var i = 0; i < cmdArray.length; i++) {
            requestJson.push({
                method: cmdArray[i][0],
                params: cmdArray[i][1],
                id: Date.now() + Math.floor(Math.random() * 10) + i
            });
        }

        var serializedRequest = JSON.stringify(requestJson);

        sendJson(serializedRequest);

    }

    function cmd(method, params, callback, streamResults, returnRawData) {
        var requestJson = JSON.stringify({
            method: method,
            params: params,
            id: Date.now() + Math.floor(Math.random() * 10)
        });
        var serializedRequest = JSON.stringify(requestJson);

        sendJson(serializedRequest);
    }


    function httpcmd(method, params, callback, streamResults, returnRawData) {

        var results = [];

        async.each(instances, function (instance, eachCallback) {

            var itemFinished = function (error, result, data) {

                var returnObj = {
                    error: error,
                    response: (result || {}).result,
                    instance: instance
                };
                if (returnRawData) returnObj.data = data;
                if (streamResults) callback(returnObj);
                else results.push(returnObj);
                eachCallback();
                itemFinished = function () {
                };
            };

            var requestJson = JSON.stringify({
                method: method,
                params: params,
                id: Date.now() + Math.floor(Math.random() * 10)
            });

            performHttpRequest(instance, requestJson, function (error, result, data) {
                itemFinished(error, result, data);
            });


        }, function () {
            if (!streamResults) {
                callback(results);
            }
        });
    }



    this.init = init;
    this.isOnline = isOnline;
    this.cmd = cmd;
    this.batchCmd = batchCmd;
    this.submit = SendSubmit;


};

DaemonInterface.prototype.__proto__ = events.EventEmitter.prototype;

exports.interface = DaemonInterface;
