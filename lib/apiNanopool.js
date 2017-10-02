var request = require('request');
var nonce   = require('nonce');

module.exports = function() {
    'use strict';

    // Module dependencies

    // Constants
    var version         = '0.1.0',
        PUBLIC_API_URL  = 'https://api.nanopool.org/v1/eth',
        PRIVATE_API_URL = 'https://api.nanopool.org/v1/eth',
        USER_AGENT      = 'nomp/node-open-mining-portal'

    var userid;

    // Constructor

    // If a site uses non-trusted SSL certificates, set this value to false
    function Nanopool(key, secret){
        // Generate headers signed by this user's key and secret.
        // The secret is encapsulated and never exposed
        this._getPrivateHeaders = function(parameters){
            var paramString, signature;

            if (!key || !secret){
                throw 'Nanopool: Error. API key and secret required';
            }

            // Sort parameters alphabetically and convert to `arg1=foo&arg2=bar`
            paramString = Object.keys(parameters).sort().map(function(param){
                return encodeURIComponent(param) + '=' + encodeURIComponent(parameters[param]);
            }).join('&');

            signature = crypto.createHmac('sha512', secret).update(paramString).digest('hex');

            return {
                Key: key,
                Sign: signature
            };
        };
    }

    // Helper methods
    function joinCurrencies(currencyA, currencyB){
        return currencyA + '-' + currencyB;
    }

    // Prototype
    Nanopool.prototype = {
        constructor: function(UserID)
        {
            this.userid = UserId;
        },

        // Make an API request
        _request: function(options, callback){
            if (!('headers' in options)){
                options.headers = {};
            }

            options.headers['User-Agent'] = USER_AGENT;
            options.json = true;
            options.strictSSL = Nanopool.STRICT_SSL;

            var resp;

            request(options, function(err, response, body) {
                resp = response;

                callback(err, body);
            });

            return this;
        },

        // Make a public API request
        _public: function(parameters, callback){
            var options = {
                method: 'GET',
                url: PUBLIC_API_URL,
                qs: parameters
            };

            return this._request(options, callback);
        },

        // Make a private API request
        _private: function(parameters, callback){
            var options;

            parameters.nonce = nonce();
            options = {
                method: 'POST',
                url: PRIVATE_API_URL,
                form: parameters,
                headers: this._getPrivateHeaders(parameters)
            };

            return this._request(options, callback);
        },


        /////



        getBalance: function( callback ){
            var options = {
//                method: 'GET',
                url: PUBLIC_API_URL + '/balance/' + userid,
                qs: null
            };

            return this._request(options, callback);
//            return this._request( 'https://api.nanopool.org/v1/eth/balance/0x977f9527a722a619381c0Af2e83E67A8C2E5Ff69', callback );
        },





        // PUBLIC METHODS

        getTicker: function(callback){
            var options = {
                method: 'GET',
                url: PUBLIC_API_URL + '/getmarketsummaries',
                qs: null
            };

            return this._request(options, callback);
        },

        // getBuyOrderBook: function(currencyA, currencyB, callback){
        //     var options = {
        //         method: 'GET',
        //         url: PUBLIC_API_URL + '/orders/' + currencyB + '/' + currencyA + '/BUY',
        //         qs: null
        //     };

        //     return this._request(options, callback);
        // },

        getOrderBook: function(currencyA, currencyB, callback){
            var parameters = {
                market: joinCurrencies(currencyA, currencyB),
                type: 'buy',
                depth: '50'
            }
            var options = {
                method: 'GET',
                url: PUBLIC_API_URL + '/getorderbook',
                qs: parameters
            }

            return this._request(options, callback);
        },

        getTradeHistory: function(currencyA, currencyB, callback){
            var parameters = {
                    command: 'returnTradeHistory',
                    currencyPair: joinCurrencies(currencyA, currencyB)
                };

            return this._public(parameters, callback);
        },


        /////


        // PRIVATE METHODS

        myBalances: function(callback){
            var parameters = {
                    command: 'returnBalances'
                };

            return this._private(parameters, callback);
        },

        myOpenOrders: function(currencyA, currencyB, callback){
            var parameters = {
                    command: 'returnOpenOrders',
                    currencyPair: joinCurrencies(currencyA, currencyB)
                };

            return this._private(parameters, callback);
        },

        myTradeHistory: function(currencyA, currencyB, callback){
            var parameters = {
                    command: 'returnTradeHistory',
                    currencyPair: joinCurrencies(currencyA, currencyB)
                };

            return this._private(parameters, callback);
        },

        buy: function(currencyA, currencyB, rate, amount, callback){
            var parameters = {
                    command: 'buy',
                    currencyPair: joinCurrencies(currencyA, currencyB),
                    rate: rate,
                    amount: amount
                };

            return this._private(parameters, callback);
        },

        sell: function(currencyA, currencyB, rate, amount, callback){
            var parameters = {
                    command: 'sell',
                    currencyPair: joinCurrencies(currencyA, currencyB),
                    rate: rate,
                    amount: amount
                };

            return this._private(parameters, callback);
        },

        cancelOrder: function(currencyA, currencyB, orderNumber, callback){
            var parameters = {
                    command: 'cancelOrder',
                    currencyPair: joinCurrencies(currencyA, currencyB),
                    orderNumber: orderNumber
                };

            return this._private(parameters, callback);
        },

        withdraw: function(currency, amount, address, callback){
            var parameters = {
                    command: 'withdraw',
                    currency: currency,
                    amount: amount,
                    address: address
                };

            return this._private(parameters, callback);
        }
    };

    return Nanopool;
}();
