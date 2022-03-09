/**
 * Controller for operations with contracts and legal entities (companies)
 * by OTT operator
 */

'use strict';

const fs = require('fs');
const path = require('path');

const Promise = require('bluebird');
const moment = require('moment');
const winston = require('winston');
const pick = require('lodash/fp/pick');

//var errors = require('../errors');
const mailer = require('../services/mailer');
const ott = require('../services/ott');
const $1c = require('../services/1c/api');
const contractPdfGenerator = require('../helpers/contractPdfGenerator');
const models = require('../models');

const logger = winston.loggers.get('app-logger');
const omit = require('lodash/fp/omit');
const Contract = models.Contract;
const Entity = models.Entity;

const extend = Object.assign;

const contractFieldsToAccept = [
    'inn',
    'kpp',
    'ogrn',
    'bik',
    'bank',
    'email',
    'phone',
    'fax',
    'legalName',
    'legalAddress',
    'actualAddress',
    'settlementAccount',
    'correspondentAccount',
    'type',
    'margin',
    'firstName',
    'lastName',
    'middleName',
    'fullName_gen',
    'position',
    'position_gen',
    'legalActingBasis_gen',
    'isSent',
    'isSigned',
    'isActive',
    'taxationScheme',
    'selfRegistered',
    // 'signingDate',
    // 'expirationDate',
    'enquiryId',
    'managerId',
    'source'
];

const contractFieldsToSend = contractFieldsToAccept.slice();
contractFieldsToSend.push(
    'id',
    'number',
    'enquiry',
    'entity',
    'manager',
    'creationDate',
    'signingDate',
    'expirationDate',
    'selfRegistered',
    'changeDate'
);


let controller =
module.exports = {
    list: getContracts,
    create: createContract,
    change: changeContract,
    get: getContract,
    getEntity: getContractEntity,
    createAdministratorAccount: changeAdministratorAccount,
    changeAdministratorAccount: changeAdministratorAccount,
    getPdf: getContractPdf,
    renderCard: renderCard,
    getOrgsByINN: getOrgsByINN,
    getManagers: getManagers
};


function getContracts(req, resp, next) {
    let include = [
       {
           model: models.Entity,
           as: 'entity',
           include: [
               {
                   model: models.User,
                   attributes: models.User.attrsExcept('passwordHash', 'salt'),
                   as: 'admin'
               }
           ]
       },
       {
           model: models.Manager,
           as: 'manager'
       }
   ];
    let dflt_order = [['id', 'DESC']];
    Contract.findAll({ where: where(req.query.flt || {}), order: order(req.query.ord || dflt_order), include: include })
        .then(function(contracts) {
            return resp.json({
                status: 'ok',
                data: contracts.map(function(contract) { return pick(contractFieldsToSend, contract.get({ plain: true })) })
            });
        })
        .catch(function(er) { next(er) })
    ;
}

function createContract(req, resp, next) {
    let values = emptyToNull(pick(contractFieldsToAccept, req.body));
    let send_pdf = Boolean(req.body.sendPdf) && (req.body.sendPdf !== 'false');
    values.settings = { "removePayByCard": false, "hideDepositBalance": false };
    // TODO: wrap the chain into transaction
    Entity
        .create(values)
        .then(function entityCreated(entity) {
            let groups = [
                {
                    name : "до 3 звезд, эконом",
                    hotelStars: 3,
                    aviaClass: 'E',
                    entityId: entity.id
                },
                {
                    name: "до 5 звезд, бизнес",
                    hotelStars: 5,
                    aviaClass: 'B',
                    entityId: entity.id
                }
            ];
            models.Group.bulkCreate(groups);
            return Contract.create(extend(values, { entityId: entity.id }));
        })
        .then(function contractCreated(contract) {
            send_pdf && mailer.contractCreated(contract, function(err, res) {
                if (err) {
                    logger.error(extend(new Error('Mailer.contractCreated failed'), { parent: err }));
                    return;
                }
                if (res && res.accepted && Array.isArray(res.accepted)) {
                    if (res.accepted.indexOf(contract.get('email')) > -1) {
                        // TODO: save the rendering history
                        contract
                            .set('isSent', true)
                            .set('renderingTemplateVersion', res.renderingTemplateVersion)
                            .save()
                        ;
                    }
                }
            });

            return retrieveContractData(contract.id).then((contract) => {
                resp.json({ status: 'ok', data: pick(contractFieldsToSend, contract.get({ plain: true })) });
            });
        })
        .catch(err => {
            logger.error(err);
            return next(err);
        })
    ;
}

function changeContractTemplateVersion(contract, toVersion, date) {
    const prevContract = omit(['entity','renderingHistory'], contract.get({ plain: true }));
    let history = contract.get('renderingHistory') || [];
    history.push(prevContract);
    return Contract
        .count()
        .then((ord) => {
            return contract
                .set('renderingHistory', history)
                .set('changeDate', moment(date).toDate())
                .set('renderingTemplateVersion', toVersion)
                // We assume it's a resigning so generate a new number
                .set('number', Contract.generateNumber(++ord, contract.get('type'), contract.get('priceGroup'), moment(date).toDate()))
                .save()
            ;
        })
    ;
}

function changeContract(req, resp, next) {
    if (!req.params.id) return next(new Error('Wrong parameters'));

    let send_pdf = Boolean(req.body.sendPdf) && (req.body.sendPdf !== 'false');
    Contract.findById(req.params.id, { include: [{ model: models.Entity, as: 'entity', required: true }] })
        .then(function searchResult(contract) {
            if (contract === null) {
                throw new Error('Not found');
            }

            let values = emptyToNull(pick(contractFieldsToAccept, req.body));
            let isActiveChanged = (values.isActive == 'false');
            if (contract.get('isActive') && !isActiveChanged) {
               throw new Error('Cannot change contract')
            }

            let templateUpdatePromise = Promise.resolve();
            let updateContractVersion = Boolean(req.body.updateContractVersion) && (req.body.updateContractVersion !== 'false');
            let tmplV = contractPdfGenerator.getCurrentTemplateVersion(contract.get('type'));
            logger.debug(
                '#mng update: %s contract: %s template version to %s, changeDate: %s',
                updateContractVersion,
                contract.get('id'),
                tmplV,
                req.body.changeDate
            );
            if (updateContractVersion && tmplV) {
                templateUpdatePromise = changeContractTemplateVersion(contract, tmplV, req.body.changeDate);
            }

            return Promise.join(
                // NOTE: After fields of type Sequelize.DATE[ONLY] have been set with (valid) string values
                // and the instance has been updated, they will not be converted to JS Date objects
                // by the getters automaticaly.
                templateUpdatePromise,
                contract.update(values),
                contract.entity.update(values),
                function legalDataUpdated(templateUpdatePromise, contract, entity) {
                    logger.debug(
                        '#mng updated contract: %j',
                        contract.get({ plain: true })
                    );
                    return retrieveContractData(contract.id);
                }
            );
        })
        .then(function contractUpdated(contract) {
            resp.json({ status: 'ok', data: pick(contractFieldsToSend, contract.get({ plain: true })) });

            send_pdf && mailer.contractCreated(contract, function(err, res) {
                if (err) {
                    logger.error(extend(new Error('Mailer.contractCreated failed'), { parent: err }));
                    return;
                }
                if (res && res.accepted && Array.isArray(res.accepted)) {
                    if (res.accepted.indexOf(contract.get('email')) > -1) {
                        // TODO: save the rendering history
                        contract
                            .set('isSent', true)
                            .save()
                        ;
                    }
                }
            });

            return null;
        })
        .catch(function(er) {
            logger.error(er);
            next(er)
        })
    ;
}

function getContract(req, resp, next) {
    if (!req.params.id) return next(new Error('Wrong parameters'));


    retrieveContractData(req.params.id)
        .then(function searchResult(contract) {
            if (contract === null) return next(new Error('Not found'));

            resp.json({ status: 'ok', data: pick(contractFieldsToSend, contract.get({ plain: true })) });
            return null;
        })
        .catch(function(er) {
            return next(er)
        })
    ;
}

function retrieveContractData(id) {
    const include = [
        {
            model: models.Entity,
            as: 'entity',
            include: [
                {
                    model: models.User,
                    attributes: models.User.attrsExcept('passwordHash', 'salt'),
                    as: 'admin',
                    required: false
                }
            ]
        },
        {
            model: models.Enquiry,
            as: 'enquiry',
            required: false
        },
        {
            model: models.Manager,
            as: 'manager',
            required: false
        }
    ];
    return Contract.findById(id, { include: include });
}

function getEntity(req, resp, next) {
    if (!req.params.id) return next(new Error('Wrong parameters'));

    Contract.findById(req.params.id)
        .then(function searchResult(contract) {
            if (contract === null) return next(new Error('Not found'));

            return contract.getEntity();
        })
        .then(function entityGotten(entity) {
            return resp.json({ status: 'ok', data: entity.get() })
        })
        .catch(function(er) {
            return next(er);
        });
}

function changeAdministratorAccount(req, resp, next) {
    if (!req.params.id) return next(new Error('Wrong parameters'));

    let data = req.body;
    ['login', 'email'].forEach(key => !!data[key] && (data[key] = data[key].trim()));

    let include_admin = {
        model: models.User,
        attributes: models.User.attrsExcept('passwordHash', 'salt'),
        as: 'admin',
        required: false
    };

    let include_entity = {
        model: models.Entity,
        as: 'entity',
        required: true,
        include: [include_admin]
    };

    let password = req.body.password;// we need this unencrypted further
    let is_new = true;
    Contract.findById(req.params.id, { include: [include_entity] })
        .then(function searchResult(contract) {
            if (contract === null) return next(new Error('Not found'));

            let entity = contract.entity;

            if (entity.admin) {
                is_new = false;
                return entity.admin.update(req.body, { fields: ['email', 'login', 'passwordHash', 'salt'] });
            } else {
                let adminData = extend({}, req.body, {
                    // TODO: Do these fields nullalbe
                    firstName: 'Имя',
                    lastName: 'Фамилия',
                    middleName: 'Отчество',
                    entityId: entity.id,
                    role: 'admin'
                });

                const createAdministrator = function() {
                    return models.User
                        .createAdministrator(adminData.entityId, adminData.login, adminData)
                        .then(function adminCreated(user) {
                            // TODO: now it's totally optimistic: no result control at all. Think if it's right.
                            contract.set('isActive', true).save();
                            entity.setAdmin(user);
                            return user;
                        })
                    ;
                };

                if (!contract.depositPassword) {
                    // Let's register the deposit
                    return ott.deposit.spawn({ clientHttpRequest: req })
                        .signup({ taxId: entity.inn, email: entity.email })
                        .then(depositResult => {
                            logger.info('OTT deposit/signup response');
                            logger.debug('%j', depositResult);

                            let deposit = JSON.parse(depositResult);

                            if (deposit.status === 'OK' && deposit.data) {
                                return deposit.data.password;
                            }

                            throw new Error(deposit.status);
                        })
                        .catch(function depositSignupError(err) {
                            throw extend(new Error('Can\'t register a deposit'), { parent: err });
                        })
                        .then(function depositRegistered(depositPassword) {
                            return contract.update({
                                'depositPassword': depositPassword,
                                isSigned: true,
                                signingDate: models.sequelize.fn('NOW')
                            });
                        })
                        .then(createAdministrator);
                } else {
                    return createAdministrator();
                }
            }
        })
        .then(function adminSaved(user) {
            resp.json({ status: 'ok', data: user.get({ plain: true }) });

            // TODO: It's bad. Wee need event objects with all needed data.
            user.password = password;
            is_new ? mailer.adminCreated(user) : mailer.adminChanged(user);

            return true;
        })
        .catch(function(er) {
            return next(er)
        });
}

function getContractEntity(req, resp, next) {

}

function getContractPdf(req, resp, next) {
    if (!req.params.id) return next(new Error('Wrong parameters'));

    Contract.findById(req.params.id)
        .then(function searchResult(contract) {
            if (contract === null) return next(new Error('Not found'));

            let tmplV = contract.get('renderingTemplateVersion');
            if (!tmplV || !(contract.get('isActive') || contract.get('isSent'))) {
                tmplV = contractPdfGenerator.getCurrentTemplateVersion(contract.get('type'))
            }
            contractPdfGenerator(contract, { templateVersion: tmplV }).toBuffer(function (err, buffer) {
                if (err) {
                    next(err);
                } else {
                    // TODO: Adopt a better idea of building of the filename for download.
                    let fname = 'OTT_'+ contract.number
                        .replace(/\//g, '-')
                        .replace('КМ', 'KM')
                        .replace('КЖ', 'KZH')
                        .replace('К', 'K')
                         +'.pdf'
                    ;
                    resp
                        .header('Content-Type', 'application/pdf')
                        .header('Content-Disposition', `attachment; filename="${fname}`)
                        .send(buffer)
                    ;

                    // TODO: save the rendering history
                    if (tmplV !== contract.get('renderingTemplateVersion')) {
                        contract.set('renderingTemplateVersion', tmplV).save();
                    }
                }
            });
        })
    ;
}

function renderCard(req, resp, next) {
    if (!req.params.id) return next(new Error('Wrong parameters'));

    Contract.findById(req.params.id)
        .then(function searchResult(contract) {
            if (contract === null) return next(new Error('Not found'));

            let tmpl_dir = path.resolve(__dirname, '../templates/contracts');
            let tmpl_path = `${tmpl_dir}/${contract.get('type')}.card.html`;
            fs.readFile(tmpl_path, 'utf8', (err, str) => {
                if (err) return next(err);

                let vars = {};
                function replace(match, name) {
                    return vars[name] ? vars[name] : '';
                }

                vars['title'] = 'Карточка договора '+ contract.get('number');
                vars['base-url'] = '/css/mng/';
                vars['contract-number'] = contract.get('number');
                vars['contract-creation-date'] = moment(contract.get('creationDate')).format('DD.MM.YYYY');
                vars['company-name'] = contract.get('legalName');
                vars['signer-full-name'] = contract.getSignerFullName();
                vars['company-legal-address'] = contract.get('legalAddress');
                vars['company-actual-address'] = contract.get('actualAddress');
                vars['company-ogrn'] = contract.get('ogrn');
                vars['company-inn'] = contract.get('inn');
                vars['company-kpp'] = contract.get('kpp');
                vars['company-settl-account'] = contract.get('settlementAccount');
                vars['company-bank'] = contract.get('bank');
                vars['company-cor-account'] = contract.get('correspondentAccount');
                vars['company-bik'] = contract.get('bik');
                vars['company-email'] = contract.get('email');
                vars['company-phone'] = contract.get('phone');
                vars['company-fax'] = contract.get('fax');
                vars['signer-position'] = contract.get('position');
                vars['signer-name-2'] = ':l :f.:m.'
                    .replace(':l', contract.get('lastName')/*.toUpperCase()*/)
                    .replace(':f', contract.get('firstName')[0].toUpperCase())
                    .replace(':l', contract.get('middleName')[0].toUpperCase())
                ;
                if (req.query.ap == '1') {
                    vars['auto-print'] = '<script type="text/javascript"> print() </script>'
                }

                resp.send(str.replace(/\{\{\s*?([\w\-\d_]+)\s*?\}\}/g, replace));
            })
        })
    ;
}

function getOrgsByINN(req, resp, next) {
    if (!req.params.inn) return next(new Error('Wrong parameters'));

    $1c
        .getClient()
        .then(function(client) {
            return new Promise(function(res, rej) {
                client.getCorporationRequisitesByINN({ INN: req.params.inn }, function(err, response) {
                    if (err) {
                        return rej(err);
                    }
                    return res(response);
                });
            });
        })
        .then(function(response) {
            logger.debug('%j', response);
            resp.json(response);
        })
        .catch(function(err) {
            logger.error(err);
            next(err);
        })
    ;
}

function getManagers(req, resp, next) {
    models.Manager
        .findAll({ order: ['lastName', 'firstName'] })
        .then((managers) => {
            resp.json({
                status: 'ok',
                data: managers.map(m => m.get({ plain: true }))
            })
            return null;
        })
    ;
    return;
}

/**
 * @param {} params
 * @returns {}
 * @see Sequelize#query
 */
function where(params) {
    let where = {};
    ['creationDate', 'signingDate'].forEach(function dateRange(key) {
        if (params[key]) {
            where[key] = { $and: {} };
            if (params[key].from) {
                where[key].$and.$gt = new Date(params[key].from);
            }
            if (params[key].to) {
                where[key].$and.$lt = new Date(params[key].to);
            }
        }
    })
    if (params.types) {
        where.type = { $in: params.types };
    }
    ['isSigned', 'isSent', 'isActive'].forEach(function boolean(key) {
        if (params[key] !== undefined) {
            where[key] = !!Number(params[key]);
        }
    })
    if (params.legalName) {
        where.legalName = { $ilike: `%${params.legalName}%` };
    }
    if (params.number) {
        where.number = { $ilike: `%${params.number}%` };
    }
    if (params.managerId) {
        where.managerId = { $in: params.managerId };
    }
    return where;
}

/**
 * @param {} params
 * @returns {}
 * @see Sequelize#query
 */
function order(params) {
    let order = {};
    // TODO: build Sequelize#query options.order object relevant to the request's order params
    return params;
    return order;
}

function emptyToNull(data) {
    let fields = [
        'enquiryId',
        'managerId'
    ];
    fields.forEach((field) => {
        if (!String(data[field]).trim().length) {
            data[field] = null;
        }
    });
    return data;
}
