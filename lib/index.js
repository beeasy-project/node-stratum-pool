var net = require('net');
var events = require('events');

//Gives us global access to everything we need for each hashing algorithm
require('./algoProperties.js');

var pool_stratum = require('./pool_stratum.js');
var pool_btc = require('./pool_btc.js');
var pool_eth = require('./pool_eth.js');

exports.daemon = require('./daemon.js');
exports.varDiff = require('./varDiff.js');


exports.createPool = function(poolOptions, authorizeFn){
    switch( poolOptions.type) {
        case "eth":
            var newPool = new pool_eth(poolOptions, authorizeFn);
            break;
        case "stratum":
            var newPool = new pool_stratum(poolOptions, authorizeFn);
            break;
        default:
            var newPool = new pool_btc(poolOptions, authorizeFn);

    }
    return newPool;
};
