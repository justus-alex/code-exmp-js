'use strict';

const fs = require('fs');
const path = require('path');

const mailer = require('../../services/mailer');
const ssImporter = require('../../helpers/spreadSheetUserImporter');
const randomPasswordHelper = require('../../helpers/randomPasswordHelper');
const StatisticsHelper = require('../../helpers/statisticsHelper');
const models = require('../../models/index');
const User = models.User;

module.exports = {
    list: list,
    create: create,
    change: change,
    get: get,
    delete: remove,
    getDocuments: getDocuments,
    getBonusCards: getBonusCards,
    getPassengerDocuments: getPassengerDocuments,
    info: info,
    getEmployeeList: getEmployeeList,
    getEmployee: getEmployee,
    createEmployee: createEmployee,
    updateEmployee: updateEmployee,
    changeEmployeePassword: changeEmployeePassword,
    documentsChangeRequest: documentsChangeRequest,
    orderLimitIncreaseRequest: orderLimitIncreaseRequest,
    import: {
        uploadFile: uploadFile,
        getPreview: getImportPreview,
        commit: commitImport,
        fileExample: getFileExample
    },
    getSearchQueries: getSearchQueries,
    logSearchQueries: logSearchQueries,
    deleteSearchQuery: deleteSearchQuery,
};

const assign = Object.assign;
const extend = assign;

function err(status, msg)
{
    let err = new Error(msg);
    err.statusCode = status;

    return err;
}

function getDocuments(req, res, next) {
    if (!req.params.id) {
        return next(err(404, 'User not found'));
    }

    User
        .findById(req.params.id)
        .then((user) => {
            if (!user) {
                return next(err(404, 'Entity not found'));
            }

            user.getDocuments()
                .then((documents) => {
                    return res.json({ data: documents.map((d) => { return d.get({ plain: true }) }) });
                })
                .catch((err) => {
                    return next(err);
                })
            ;
        })
        .catch((err) => {
            return next(err);
        })
    ;
}

function getPassengerDocuments(req, res, next) {
    req.user
        .getPassengerDocuments({ isExpired: null })
        .then(documents => {
            if (req.get('X-OTT-B2B-Client') == 'fe-api') {
                // Return it unchanged for own FE, assuming it's normalized user input
                return documents;
            }
            // Strip unwanted characters from documents of known type for all other consumers
            let stripTypes = [
                'ru.passport',
                'ru.foreign_passport',
                'ru.birth_certificate'
            ];
            return documents.map(document => {
                let type = (''+ document.citizenship + '.'+ document.type).toLowerCase();
                if (stripTypes.indexOf(type) > -1) {
                    document.number = document.number
                        .replace(/\s/g, '')
                        .replace(/\-/g, '')
                    ;
                }
                return document;
            });
        })
        .then(documents => {
            return res.json({ data: documents });
        })
        .catch(err => {
            return next(err);
        });
}

function info(req, res, next) {
    User.getInfo(req.user.id)
        .then((userInfo) => {
            let data = userInfo;
            if (req.session && req.session.__b2b_attemptedDownload) {
                data.attemptedDownload = req.session.__b2b_attemptedDownload;
                delete req.session.__b2b_attemptedDownload;
            }
            return res.json({ data: data });
        })
        .catch((error) => {
            return next(error);
        });
}

function getEmployeeList(req, res, next) {
    User.getEmployeesByEntityId(req.user.entityId)
        .then((employees) => {
            return res.json({ data: employees });
        })
        .catch((error) => {
            return next(error);
        });
}

function getEmployee(req, res, next) {
    let id = req.params.id;
    let entityId = req.user.entityId;

    User.getEmployeeByIdAndEntityId(id, entityId)
        .then((employee) => {
            if (!employee) {
                return next(err(404, 'Not found'));
            }

            let result = employee.get({ plain: true });
            let aclGroups = [];

            employee.aclGroups.forEach((group) => {
                aclGroups.push(group.name);
            });

            result.aclGroups = aclGroups;
            delete result.departmentId;
            delete result.entityId;
            delete result.groupId;

            return res.json({ data: result });
        }).catch((error) => {
            return next(error);
        });
}

function createEmployee(req, res, next) {
    let password = randomPasswordHelper.generate();

    User.createEmployee(req.user.entityId, req.user.login, req.body, password)
        .then((employee) => {
            // TODO: It's bad. Wee need event objects with all needed data.
            employee.password = password;
            mailer.employeeAdded(employee);

            return User.getEmployeesByEntityId(req.user.entityId)
        })
        .then((employees) => {
            return res.json({ data: employees });
        })
        .catch((error) => {
            return next(error);
        })
    ;
}

function updateEmployee(req, res, next) {
//    let id = req.body.id;
    let id = req.params.id;
    let entityId = req.user.entityId;

    User.getEmployeeByIdAndEntityId(id, entityId)
        .then((employee) => {
            if (!employee) {
                return next(err(404, 'Not found'));
            }

            return User.updateEmployee(employee, req.body)
                .then(() => {
                    return User.getEmployeesByEntityId(req.user.entityId);
                });
        })
        .then((employees) => {
            return res.json({ data: employees });
        })
        .catch((error) => {
            return next(error);
        })
    ;
}

function changeEmployeePassword(req, res, next) {
    let user = req.user;
    let paramId = Number(req.params.id);

    User
        .getEmployeeByIdAndEntityId(paramId, user.entityId)
        .then((employee) => {
            if (!employee) {
                return next(err(404, 'Not found'));
            }

            return employee
                .changePassword()
                .then((newPassword) => {
                    // TODO: It's bad. Wee need event objects with all needed data.
                    employee.password = newPassword;
                    mailer.employeeRequisitesChanged(employee);

                    res.json({ status: 'success' });

                    StatisticsHelper.withClientRequest(req).passwordReset(user, employee);
                    
                    return null;
                })
        })
        .catch((error) => {
            return next(error);
        })
    ;
}

/**
 * @param  {express.Request}   req  [description]
 * @param  {express.Response}   res  [description]
 * @param  {Function} next [description]
 */
function getFileExample(req, res, next) {
    // TODO: a separate directory for static public resources?
    const fileName = 'employees_import_example.'+ req.params.type;
    const filePath = path.resolve(__dirname +'/../../resources/'+ fileName);
    fs.access(filePath, fs.R_OK, (err) => {
        if (err) {
            return next(assign(new Error('Not found'), { statusCode: 404 }));
        }

        return res.download(filePath, fileName, function(err) {
            if (err) {
                next(err);
            }
        });
    });
}

/**
 * Expects a spreadsheet file in the request
 *
 * @param  {express.Request}   req  [description]
 * @param  {Object}   req.file  [description]
 * @param  {string}   req.file.path  [description]
 * @param  {express.Response}   res  [description]
 * @param  {Function} next [description]
 */
function uploadFile(req, res, next) {
    if (!req.file) {
        return next(new Error('No file in the request'));
    }
    let params = req.body;
    let preview = Boolean(req.body.preview) || true;
    let fileData = req.file;
    fs.access(fileData.path, fs.R_OK, function(err) {
        if (err) {
            return next(new Error('Cannot read the uploaded file at the path '+ fileData.path));
        }
        let importId = Date.now();
        // saving the import session
        if (!req.session.employeesImports) {
            req.session.employeesImports = {};
        }
        req.session.employeesImports[String(importId)] = {
            file: assign({}, fileData, {
                buffer: fileData.buffer || fs.readFileSync(fileData.path)
            }),
            preview: null,
            result: null,
            commited: false
        };
        let respData = { data: { importId: importId } };
        if (!preview) {
            // The client didn't request the preview
            res.json(respData);
        }
        let importerConfig = {
            entityId: req.user.entityId,
            contractType: req.user.entity.contract.type,
            login: req.user.login,
            save: false,
            parserConfig: {
                encoding: 'utf8'
            }
        };

        ssImporter(importerConfig)
            .fromFile(fileData.path, function(err, result) {
                if (err) {
                    // Parsing issue, basically
                    let _err = new Error('Import error');
                    _err.statusCode = 400;
                    _err.parent = err;
                    return next(_err);
                }
                result.filename = fileData.name;
                req.session.employeesImports[importId].preview = result;
                if (!preview) {
                    // We've sent response before
                    return;
                }
                // Preparing the response
                let _result = extend({}, result);
                _result.recordResults = result.recordResults.map(function(result) {
                    let _result = extend({}, result);
                    if (result.createdUser) _result.createdUser = result.createdUser.get({ plain: true });
                    if (result.createdDepartment) _result.createdDepartment = result.createdDepartment.get({ plain: true });
                    if (result.createdDocument) _result.createdDocument = result.createdDocument.get({ plain: true });

                    return _result;
                });
                respData.data.importPreview = _result;
                return res.json(respData);
            })
        ;
    });
}

/**
 * @param  {express.Request}   req  [description]
 * @param  {Object}   req.params  [description]
 * @param  {int}   req.params.id  import ID
 * @param  {express.Response}   res  [description]
 * @param  {Function} next [description]
 */
function getImportPreview(req, res, next) {
    let importId = String(req.params.id);
    if (!importId) {
        return next(extend(new Error('No importId param'), { statusCode: 400 }));
    }
    if (!req.session.employeesImports || !req.session.employeesImports[importId]) {
        return next(extend(new Error('No import'), { statusCode: 404 }));
    }
    return res.json({ data: { importPreview: req.session.employeesImports[importId].preview } });
}

/**
 * @param  {express.Request}   req
 * @param  {Object}   req.params
 * @param  {int}   req.params.id  import ID
 * @param  {Object}   req.body
 * @param  {Array}   req.body.selectedRecords
 * @param  {express.Response}   res
 * @param  {Function} next
 */
function commitImport(req, resp, next) {
    let importId = String(req.params.id);
    if (!importId) {
        return next(extend(new Error('No importId param'), { statusCode: 400 }));
    }
    if (!Array.isArray(req.body.selectedRecords) || req.body.selectedRecords.length < 1) {
        return next(extend(new Error('No records selected for import'), { statusCode: 400 }));
    }
    let selectedRecords = req.body.selectedRecords;
    let importData;
    if (!req.session.employeesImports || !(importData = req.session.employeesImports[importId])) {
        return next(extend(new Error('No import'), { statusCode: 404 }));
    }
    let fileData = importData.file;
    // Restoring the buffer after it was serialized by the the session storage
    if (fileData.buffer.type === 'Buffer') {
        fileData.buffer = new Buffer(fileData.buffer.data);
    }
    let importerConfig = {
        entityId: req.user.entityId,
        contractType: req.user.entity.contract.type,
        login: req.user.login,
        save: true,
        recordNumbers: selectedRecords,
        parserConfig: {
            encoding: fileData.encoding || 'utf8'
        }
    };
    ssImporter(importerConfig)
        .fromBuffer(fileData.buffer, function(err, result) {
            if (err) {
                // Parsing issue, basically
                let _err = new Error('Import error');
                _err.statusCode = 400;
                _err.parent = err;
                return next(_err);
            }
            req.session.employeesImports[importId].result = result;
            req.session.employeesImports[importId].commited = true;
            delete req.session.employeesImports[importId].preview;
            delete req.session.employeesImports[importId].buffer;
            // Preparing the response
            let _result = extend({}, result);
            _result.recordResults = result.recordResults.map(function(result) {
                let _result = extend({}, result);
                if (result.createdUser) _result.createdUser = result.createdUser.get({ plain: true });
                if (result.createdDepartment) _result.createdDepartment = result.createdDepartment.get({ plain: true });
                if (result.createdDocument) _result.createdDocument = result.createdDocument.get({ plain: true });

                return _result;
            });
            return resp.json({ status: 'ok', data: { importResult: _result } });
        })
    ;
}

function documentsChangeRequest(req, resp, next) {
    if (!req.user) {
        return next(extend(new Error('No user'), { statusCode: 404 }));
    }
    mailer.documentsChangeRequest(req.user);

    return resp.json({ status: 'success' });// TODO: we don't know, actually. Need to refactor the mailer.
}

function orderLimitIncreaseRequest(req, resp, next) {
    if (!req.user) {
        return next(extend(new Error('No user'), { statusCode: 404 }));
    }
    mailer.orderLimitIncreaseRequest(req.user);

    return resp.json({ status: 'success' });// TODO: we don't know, actually. Need to refactor the mailer.
}

function getSearchQueries(req, resp, next) {
    let type = req.query.type;
    if (type && !models.SearchQuery['SERVICE_TYPE_'+ String(type).toUpperCase()]) {
        next(err(400, 'Wrong type'));
        return;
    }

    let user = req.user;
    let limit = req.query.limit;
    let order = req.query.order || [['date', 'DESC']];

    models.SearchQuery
        .findAll({
            where: {
                userId: user.id,
                type: type || undefined
            },
            order: order,
            limit: limit || undefined
        })
        .then((items) => {
            return items.map(i => i.get({ plain: true }));
        })
        .then((items) => {
            resp.json({ status: 'success', data: items });
            return null;
        })
        .catch((err) => {
            next(err);
            return null;
        })
    ;
}

function logSearchQueries(req, resp, next) {
    let user = req.user;
    let type = req.body.type;
    if (!models.SearchQuery['SERVICE_TYPE_'+ String(type).toUpperCase()]) {
        next(err(400, 'Wrong type'));
        return;
    }

    let params = req.body.params;
    let hash = models.SearchQuery.hashParams(params);
    let where = {
        userId: user.id,
        type: type,
        hash: hash
    };
    let dflts = assign({}, where, {
        params: params
    });
    models.SearchQuery
        .findOrCreate({
            where: where,
            defaults: dflts
        })
        .spread((item, created) => {
            resp.json({ status: 'success' });

            if (created) {
                models.SearchQuery.truncate(user.id, type);
            } else {
                item.destroy();
                models.SearchQuery.create(dflts);
            }

            return null;
        })
        .catch((err) => {
            next(err);
            return;
        })
    ;
}

function deleteSearchQuery(req, resp, next) {
    let user = req.user;
    let id = parseInt(req.params.id);
    if (isNaN(id)) {
        next(err(400, 'Wrong parameters'));
        return;
    }
    let where = {
        userId: user.id,
        id: id
    };
    models.SearchQuery
        .findOne({
            where: where
        })
        .then((item) => {
            if (!item) {
                next(err(404, 'Not found'));
                return;
            } else {
                item.destroy();
                resp.json({ status: 'success' });
            }
        })
        .catch((err) => {
            next(err);
            return;
        })
    ;
}
