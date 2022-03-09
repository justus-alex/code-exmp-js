/**pre
 * Hotels controller
 */

'use strict';

const cp = require('child_process');
const path = require('path');
const qs = require('querystring');

const request = require('request');
const config = require('config');
const _ = require('lodash');
const winston = require('winston');

const models = require('../models');
const ott = require('../services/ott');


let logger = winston.loggers.get('app-logger');

let demoInnList = config.demoInn || [];

module.exports = {
    hotelPolicyRequest: hotelPolicyRequest,
    startCreateOrder: startCreateOrder,
    getHotelProcessResult: getHotelProcessResult,
    continue3ds: continue3ds,
    createOrderAfter3ds: createOrderAfter3ds,
    getGuestVoucher: getGuestVoucher,
    searchRequest: searchRequest,
    suggestRequest: suggestRequest,
    objectRequest: objectRequest,
    hotelRequest: hotelRequest,
    offersRequest: offersRequest,
    getTypes: getTypes,
    getFacilities: getFacilities,
    getImages: getImages,
    searchPolling: searchPolling
};

function getOttApiPrefix(source) {
    return (source === 'corporate' ? 'b2b_net' : 'b2b_comm') + '/api';
}

function pipeOttApiMethod(req, res, method, requestParams) {
    let ottB2bParams = req.ottB2bParams || {};
    let source = ottB2bParams.source;
    if (source === 'concierge') {
        source = 'commissioner';
    }
    let hapi = `${config.ott.hotelsHost}${getOttApiPrefix(source)}/${method}/`;
    // ott.avia.defaultHeaders contains the Authorization header basically.
    let headers = Object.assign({}, ott.hotel.defaultHeaders);
    if (ottB2bParams.depositAccountCookie) {
        // FIXME: It will override the defaultHeaders's Cookie header if present.
        Object.assign(headers, { 'Cookie': ottB2bParams.depositAccountCookie });
    }
    if (req.headers['x-real-ip']) {
        Object.assign(headers, { 'X-Real-IP': req.headers['x-real-ip'] });
    }

    let params = Object.assign({
        method: 'GET',
        url: hapi,
        qs: req.query,
        rejectUnauthorized: false,
        timeout: 100000,
        followRedirect: true,
        maxRedirects: 10,
        headers: headers
    }, requestParams || {});

    logger.debug(`Piping OTT API method /${method}, params: %s`, JSON.stringify(params));

    request(params)
        .on('error', function(err) {
            logger.error('..the request emited an error', err);
            // next(err);
        })
        .pipe(res)
    ;
}

function suggestRequest(req, res, next) {
    pipeOttApiMethod(req, res, 'suggestRequest');
}

function searchPolling(req, res, next) {
    pipeOttApiMethod(req, res, 'searchPolling');
}

function hotelPolicyRequest(req, res, next) {
    let ottB2bParams = req.ottB2bParams || {};

    let source = ottB2bParams.source;
    if (source === 'concierge') {
        source = 'commissioner';
    }

    let params = Object.assign({}, req.body, { source: source });
    let options = {};

    if (ottB2bParams.depositAccountCookie) {
        options.headers = { 'Cookie': ottB2bParams.depositAccountCookie };
    }

    ott.hotel.spawn({ clientHttpRequest: req })
        .hotelPolicyRequest(params, options)
        .then((response) => {
            return response.data;
        })
        .then((data) => {
            return res.json(data);
        })
        .catch((err) => {
            return next(err);
        })
    ;
}

/**
 * [continue3ds description]
 *
 * @param  {Express.Request} req
 * @param  {Express.Response} res
 * @param  {Function} next
 * @return {undefined}
 * @todo test
 */
function continue3ds(req, res, next) {
    pipeOttApiMethod(req, res, 'searchPolling', { method: 'POST', form: req.body });
}

/**
 * [searchRequest description]
 *
 * @param  {Express.Request} req
 * @param  {Express.Response} res
 * @param  {Function} next
 * @return {undefined}
 */
function searchRequest(req, res, next) {
    pipeOttApiMethod(req, res, 'searchRequest');
}

/**
 * [objectRequest description]
 *
 * @param  {Express.Request} req
 * @param  {Express.Response} res
 * @param  {Function} next
 * @return {undefined}
 */
function objectRequest(req, res, next) {
    pipeOttApiMethod(req, res, 'objectRequest');
}

/**
 * [offersRequest description]
 *
 * @param  {Express.Request} req
 * @param  {Express.Response} res
 * @param  {Function} next
 * @return {undefined}
 */
function offersRequest(req, res, next) {
    pipeOttApiMethod(req, res, 'offersRequest');
}

/**
 * [hotelRequest description]
 *
 * @param  {Express.Request} req
 * @param  {Express.Response} res
 * @param  {Function} next
 * @return {undefined}
 */
function hotelRequest(req, res, next) {
    pipeOttApiMethod(req, res, 'hotelRequest');
}

/**
 * [getTypes description]
 *
 * @param  {Express.Request} req
 * @param  {Express.Response} res
 * @param  {Function} next
 * @return {undefined}
 */
function getTypes(req, res, next) {
    pipeOttApiMethod(req, res, 'getTypes');
}

/**
 * [getFacilities description]
 *
 * @param  {Express.Request} req
 * @param  {Express.Response} res
 * @param  {Function} next
 * @return {undefined}
 */
function getFacilities(req, res, next) {
    pipeOttApiMethod(req, res, 'getFacilities_v2');
}

function getImages(req, res, next) {
    let ottB2bParams = req.ottB2bParams || {};
    let headers = {};

    if (ottB2bParams.depositAccountCookie) {
        headers = { 'Cookie': ottB2bParams.depositAccountCookie };
    }
    if (req.headers['x-real-ip']) {
        Object.assign(headers, { 'X-Real-IP': req.headers['x-real-ip'] });
    }

    let params = {
        method: 'GET',
        url: `${config.ott.hotelsHost}images/` + req.params.id,
        qs: req.query,
        rejectUnauthorized: false,
        timeout: 50000,
        followRedirect: true,
        maxRedirects: 10,
        headers: headers
    };

    request(params)
        .on('error', function(err) {
            logger.error('Hotel: getImages() returns error...', err);
        })
        .pipe(res)
    ;
}

function startCreateOrder(req, res, next) {
    let ottB2bParams = req.ottB2bParams || {};
    let params = Object.assign({}, req.body);

    let source = ottB2bParams.source;
    if (source === 'concierge') {
        source = 'commissioner';
    }

    let data = Object.assign(JSON.parse(params.params), { source: source, reseller: source });

    let options = {};
    let bookedFor = [];
    let entity = req.user.entity || {};
    if (ottB2bParams.depositAccountCookie) {
        options.headers = { 'Cookie': ottB2bParams.depositAccountCookie };
    }
    logger.debug('#Hotel startCreateOrder params: %s', JSON.stringify(data));
    prepareGuests(data.guests, req.user)
        .then((guestsData) => {
            data = Object.assign(data, guestsData.guests);
            delete data.guests;
            params.params = data;
            bookedFor = guestsData.bookedFor;

            return ott.hotel.spawn({ clientHttpRequest: req })
                .startCreateOrder(params, options, demoInnList.indexOf(entity.inn) !== -1)
                .then((response) => {
                    return response.data;
                });
        })
        .then((data) => {
            if (!data.error && data.result && data.result.processId) {
                logger.debug('#Process status %s', data.result.status);
                hotelsPolling(data.result.processId, req.user.id, bookedFor);
            }
            return res.json(data);
        })
        .catch((err) => {
            return next(err);
        });
}

function hotelsPolling(processId, userId, bookedFor) {
    models.Process
        .findOne({ where: { processId: processId, 'type': 'hotel' } })
        .then(data => {
            logger.debug('#Process data if exists %s', data);
            if(!data) {
                models.Process.create({
                    processId: processId,
                    status: 'InProcess',
                    type: 'hotel',
                    userId: userId,
                    bookedFor: bookedFor || []
                }).then(() => {

                    setTimeout(() => {
                        const pollingProcess = cp.fork(path.join(__dirname, '../components/order/polling.js'));
                        pollingProcess.send({ processId: processId, type: 'hotel', bookedFor: bookedFor });
                        pollingProcess.on('message', (processData) => {
                            if (processData.status === 'InProcess') {
                                setTimeout(() => {
                                    pollingProcess.send({
                                        processId: processData.processId,
                                        type: 'hotel',
                                        bookedFor: processData.bookedFor
                                    });
                                }, 10000);
                            } else {
                                logger.debug('#kill hotel pollingProcess');
                                pollingProcess.kill('SIGHUP');
                            }
                        });
                    }, 3000);

                });
            }
        });
}

function createOrderAfter3ds(req, res, next) {
    let params = Object.assign({}, req.body);
    logger.debug('#Process status %s', params);

    if (params.processId) {
        if (params.prevProcessId) {
            models.Process
                .findOne({ where: { processId: params.prevProcessId, 'type': 'hotel' } })
                .then(data => {
                    hotelsPolling(params.processId, req.user.id, data.bookedFor);
                });
        } else {
            hotelsPolling(params.processId, req.user.id, []);
        }
    }

    res.json({processId: params.processId});

}

function getHotelProcessResult(req, res, next) {
    let params = Object.assign({}, req.body);

    return models.Process.findOne({ where: {
        processId: params.id,
        type: 'hotel'
    }}).then((process) => {
        return res.json(process);
    });
}

function getGuestVoucher(req, res, next) {
    let token = req.params.token;
    let params = {
        lang: req.query.lang || 'ru',
        locale: req.query.locale || 'ru',
        mode: req.query.mode || 'hotel',
        guest_id: req.query.guest_id || ''
    };
    // FIXME: Use some proper OTT API configuration
    let url = `${config.ott.host}/voucher/${token}.pdf?${qs.stringify(params)}`;
    let headers = {};
    if (req.headers['x-real-ip']) {
        Object.assign(headers, { 'X-Real-IP': req.headers['x-real-ip'] });
    }
    let src = request({
        url: url,
        headers: headers
    });

    logger.debug(`#getGuestVoucher url: ${url}`);

    req.pipe(src).pipe(res);
}

/**
 *
 * @param {Array} guests
 * @returns {Promise<Object>}
 */
function prepareGuests(guests, user) {
    let processedGuests = [];

    return user.getPassengerDocuments().then((documents) => {
        let bookedFor = [];

        _.each(guests, (guest, i) => {
            let document = _.find(documents, {id: guest.documentId});

            processedGuests[`guest[${i}][first_name]`] = guest.first_name;
            processedGuests[`guest[${i}][last_name]`] = guest.last_name;
            processedGuests[`guest[${i}][type]`] = guest.type;

            if (document) {
                let userId = _.first(document.user)
                    ? _.first(document.user).id
                    : _.first(document.client).id;
                bookedFor.push(userId);
                processedGuests[`guest[${i}][document_number]`] = document.number;
            }

        });
        return { guests: processedGuests, bookedFor: bookedFor };
    });

}
