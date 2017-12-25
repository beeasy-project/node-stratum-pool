// const net = require('net');
// const events = require('events');

//Gives us global access to everything we need for each hashing algorithm
require('./algoProperties.js');

const poolStratum = require('./pool_stratum.js');
const poolBtc = require('./pool_btc.js');
const poolEth = require('./pool_eth.js');

exports.daemon = require('./daemon.js');
exports.varDiff = require('./varDiff.js');


exports.createPool = (poolOptions, authorizeFn) => {
    let newPool = undefined;
    switch (poolOptions.type) {
        case "eth":
            newPool = new poolEth(poolOptions, authorizeFn);
            break;
        case "stratum":
            newPool = new poolStratum(poolOptions, authorizeFn);
            break;
        default:
            newPool = new poolBtc(poolOptions, authorizeFn);
    }
    return newPool;
};
