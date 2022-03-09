'use strict'

const _pick = require('lodash/pick');

module.exports = CurrencyConvertor;

/**
 * @param  {object} ratesOrConf
 * @param  {object|string} dfltFromCurOrConf
 * @param  {string} dfltToCur
 *
 * @return {CurrencyConvertor}
 */
function CurrencyConvertor(ratesOrConf, dfltFromCurOrConf, dfltToCur) {
    if (this === undefined) {
        return new CurrencyConvertor(ratesOrConf, dfltFromCurOrConf, dfltToCur);
    }

    let dfltConf = {
        dfltFromCur: null,
        dfltToCur: null,
        tryReverseRate: true
    };
    let confKeys = Object.keys(dfltConf);

    if (Object.prototype.toString.call(ratesOrConf) !== '[object Object]') {
        throw new TypeError('The first argument expected to be a plain object (rates or config)');
    }

    let __rates;
    let __config;

    let rates;
    let config;

    if (ratesOrConf.rates) {
        config = ratesOrConf;
        rates = config.rates;
    } else {
        rates = ratesOrConf;
        if (Object.prototype.toString.call(dfltFromCurOrConf) === '[object Object]') {
            config = dfltFromCurOrConf;
        } else {
            config = {
                dfltFromCur: dfltFromCurOrConf,
                dfltToCur: dfltToCur
            };
        }
    }
    setRates(rates);
    setConfig(Object.assign({}, dfltConf, _pick(config, confKeys)));


    function setRates(rates) {
        __rates = rates;
        return this;
    }
    this.setRates = setRates.bind(this);

    function getRates() {
        return __rates;
    }
    this.getRates = getRates.bind(this);

    function setConfig(config) {
        __config = config;
        return this;
    }
    this.setConfig = setConfig.bind(this);

    function getConfig() {
        return __config;
    }
    this.getConfig = getConfig.bind(this);
}

/**
 * @param  {number} amount
 * @param  {string} fromCur
 * @param  {string} toCur
 *
 * @return {number}
 */
CurrencyConvertor.prototype.convert = function(amount, fromCur, toCur) {
    let config = this.getConfig();

    fromCur = fromCur ? String(fromCur).trim().toUpperCase() : config.dfltFromCur;
    if (!fromCur) {
        throw new Error('No fromCurrency provided');
    }
    toCur = toCur ? String(toCur).trim().toUpperCase() : config.dfltToCur;
    if (!toCur) {
        throw new Error('No toCurrency provided');
    }
    
    if (fromCur === toCur) {
        return amount;
    }

    let directKey = `${fromCur}${toCur}`;
    let reverseKey = `${toCur}${fromCur}`;
    let rate;
    let rates = this.getRates();

    if (rates[directKey]) {
        rate = Number(rates[directKey]);
        if (NaN === rate) {
            throw new TypeError('Invalid rate (expecting a number)');
        }
        return amount * rate;
    } else if (config.tryReverseRate && rates[reverseKey]) {
        rate = Number(rates[reverseKey]);
        if (NaN === rate) {
            throw new TypeError('Invalid rate (expecting a number)');
        }
        return amount * (1 / rate);
    }

    throw new Error('No requested rate found');
};

/**
 * @param  {number} amount
 * @param  {string} fromCur
 *
 * @return {number}
 */
CurrencyConvertor.prototype.convertFrom = function(fromCur, amount) {
    let config = this.getConfig();
    if (!config.dfltToCur) {
        throw new Error('No default toCurrency set');
    }
    return this.convert(amount, fromCur, config.dfltToCur);
};

/**
 * @param  {number} amount
 * @param  {string} toCur
 *
 * @return {number}
 */
CurrencyConvertor.prototype.convertTo = function(toCur, amount) {
    let config = this.getConfig();
    if (!config.dfltFromCur) {
        throw new Error('No default fromCurrency set');
    }
    return this.convert(amount, config.dfltFromCur, toCur);
};
