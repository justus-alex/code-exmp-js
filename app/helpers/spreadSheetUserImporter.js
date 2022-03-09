'use strict';

const fs = require('fs');
const path = require('path');

const xlsx = require('xlsx');
const pick = require('lodash/fp/pick');
const diff = require('lodash/fp/difference');
const Promise = require('bluebird');
const moment = require('moment');

const ACL = require('../../lib/aclConstants');
const map = require('../../lib/transliter/maps/ru-en.b2b.js');
const getTransliter = require('../../lib/transliter');
const genPwd = require('./randomPasswordHelper').generate;
const models = require('../models');

const User = models.User;
const Document = models.Document;
const translit = getTransliter(map);

module.exports = function(config) {
    return new Importer(config);
};

const assign = Object.assign;
const extend = assign;

function Importer(config) {
    this.config = extend({}, Importer.dfltConfig, config);
}

let columnTitles = {
    lastName: 'Фамилия',
    firstName: 'Имя',
    middleName: 'Отчество',
    birthday: 'Дата рожд.',
    email: 'Эл. почта',
    // login: 'Логин',
    phone: 'Тел.',
    department: 'Группа сотр.',
    group: 'Огранич. на заказ',
    doc_type: 'Тип документа',
    doc_number: 'Номер документа',
    // doc_fullName: 'Полное имя',
    doc_lastName: 'Фамилия',
    doc_firstName: 'Имя',
    doc_middleName: 'Отчество',
    doc_gender: 'Пол',
    doc_citizenship: 'Гражданство',
    doc_issueDate: 'Дата выдачи',
    doc_expirationDate: 'Действ. до',
    perm_canOrder: 'Может заказывать билеты и отели',
    perm_canOrderForOthers: 'Может заказывать на других сотрудников',
    perm_canViewFinReports: 'Может просматривать фин. отчёты'
};
Importer.dfltConfig = {
    entityId: null,
    login: null,
    recordNormalizer: normalize,
    save: false,
    recordNumbers: null,
    parserConfig: {
        // delimiter: ', ',
        // rowDelimiter: 'auto',
        // rowDelimiter: null,
        // rowDelimiter: 'unix',
        // rowDelimiter: '\n',
        // quote: '"',
        // comment: '#',
        // skip_empty_lines: true,
        // max_limit_on_data_read: 5000,
        // trim: true,
        // auto_parse: false,
        // columns: false,
        // columns: function(headerLine) {
        //     return Object.keys(columnTitles);
        // },
        encoding: 'utf8',
        raw: true
    }
}

function initImporter() {
    if (!(this instanceof Importer)) throw new TypeError('this is not a CsvImporter');

    if (this.initialized) return Promise.resolve();

    let _this = this;
    let entityId = this.config.entityId;
    return models.Entity
        .findById(entityId, {
            include: [
                {
                    model: models.User,
                    attributes: models.User.attrsExcept('passwordHash', 'salt'),
                    as: 'users',
                    include: [{ model: models.Department, as: 'department' }]
                },
                { model: models.Department, as: 'departments' },
                { model: models.Group, as: 'groups' }
            ]
        })
        .then(function(entity) {
            if (!entity) {
                throw new Error(`The company with ID ${entityId} doesnt exist`);
            }
            _this.entity = entity;
            _this.initialized = true;
        })
    ;
}

Importer.prototype.initialized = false;

Importer.prototype.getParser = function(data, cb) {
    let config = this.config.parserConfig;
    try {
        var wb = xlsx.read(data, assign({ type: 'buffer' }, config));
    } catch (err) {
        console.error(err);
        cb(err, null);
        return null;
    }

    try {
        let sheet = wb.Sheets[wb.SheetNames[0]];
        let data = xlsx.utils.sheet_to_json(sheet, {
            raw: true,
            range: 1,
            header: Object.keys(columnTitles)
        });
        cb(null, data);
    } catch (err) {
        console.error(err);
        cb(err, null);
        return null;
    }
    return true;
};

Importer.prototype.fromFile = function(filePath, cb) {
    let _this = this;

    filePath = path.resolve(process.cwd(), filePath);
    fs.access(filePath, fs.R_OK, function(err) {
        if (err) return cb(new Error('Cannot read file '+ filePath));

        return _this.fromBuffer(fs.readFileSync(filePath), cb);
    });
};

Importer.prototype.fromBuffer = function(buff, cb) {
    let _this = this;
    return initImporter.apply(this)
        .then(function() {
            _this.onResult = cb;
            return _this.getParser(buff, _this.parsed.bind(_this));
        })
        .catch(function(err) {
            return cb(err);
        })
    ;
};

Importer.prototype.parsed = function(err, data) {
    if (err) {
        return this.onResult(err);
    }
    return this.processInput(data).then(function(result) { this.onResult(null, result) }.bind(this));
}

Importer.prototype.processInput = function(data) {
    let result = {
        failedNumber: 0,
        recordResults: []
    }
    let config = this.config;
    return Promise
        .mapSeries(data
            .filter(function(record, index) {
                return !config.recordNumbers || config.recordNumbers.indexOf(index) > -1;
            }),
            (record) => {
                return this.processRecord.bind(this)(record);
            }
        )
        .then(function(recordResults) {
            result.recordResults = recordResults;
            recordResults.forEach(function(recordResult) { if (!recordResult.createdUser) result.failedNumber++ });
            return result;
        })
    ;
}

Importer.prototype.processRecord = function(record) {
    let result = {
        parsedData: record,
        createdUser: null,
        duplicatingUser: null,
        groupSpecified: false,
        foundGroup: null,
        departmentSpecified: false,
        foundDepartment: null,
        createdDepartment: null,
        departmentValidationError: null,
        userValidationError: null,
        documentSpecified: false,
        documentValidationError: null,
        createdDocument: null,
        errors: []
    };
    const entity = this.entity;
    const config = this.config;
    record = normalize(record);

    let userData = extend({
            entityId: config.entityId,
            login: config.login,
            role: 'employee',
            password: genPwd()
        },
        extractUserData(record)
    );
    // Permissions
    let aclGroupsNames = [];
    let permData = extend({
            canOrder: false,
            canOrderForOthers: false,
            canViewFinReports: false
        },
        extractPermData(record)
    );
    if (config.contractType !== models.Contract.TYPE_CORP) {
        // Only for corporators
        delete permData.canOrderForOthers;
    }
    permData.canOrder && aclGroupsNames.push(ACL.GROUP.ORDER_CREATOR);
    permData.canOrderForOthers && aclGroupsNames.push(ACL.GROUP.OTHER_EMPLOYEES_ORDER_CREATOR);
    permData.canViewFinReports && aclGroupsNames.push(ACL.GROUP.FINANCIAL_REPORT_VIEWER);
    let aclGroups = aclGroupsNames.map((name) => { return { name: name } });

    let user = User.build(
        userData,
        {
            include: [
                { model: models.Department, as: 'department' },
                { model: models.Group, as: 'group' },
                { model: models.Document, as: 'documents' }
            ]
        })
    ;
    let documentData = extractDocumentData(record);
    let document = null;
    // Check if there is any document data
    let hasDocumentData = Object.keys(documentData)
        .map(function(key) { return documentData[key] })
        .some(function(v) { return !!v })
    ;
    if (hasDocumentData) {
        documentData = extend({ isActive: true }, documentData);
        ['firstName', 'lastName', 'middleName'].forEach((field) => {
            if (documentData.type == Document.TYPE_FOREIGN_PASSPORT) {
                documentData[field +'_int'] = documentData[field];
            } else {
                documentData[field +'_loc'] = documentData[field];
                documentData[field +'_int'] = translit(documentData[field +'_loc']);
            }
            delete documentData[field];
        });
        document = Document.build(documentData);
        result.documentSpecified = true;
    }
    let groupName = record.group;
    let group = null;
    let departmentName = record.department;
    let department = null;

    function findCompanyGroup(groupName) {
        let foundGroup = entity.get('groups').find(function(group) {
            return group.get('name').replace(/\s/g, '').toLowerCase()
                === String(groupName).replace(/\s/g, '').toLowerCase();
        });
        return foundGroup;
    }

    function findCompanyDepartment(departmentName) {
        let foundDepartment = entity.get('departments').find(function(department) {
            return department.get('name').replace(/\s/g, '').toLowerCase()
                === String(departmentName).replace(/\s/g, '').toLowerCase();
        });
        return foundDepartment;
    }

    function findCompanyUser(testUser) {
        let foundUser = entity.get('users').find(function(user) {
            return user.getReallyFullName().toLowerCase() === testUser.getReallyFullName().toLowerCase()
        });
        return foundUser;
    }

    let checkUser = Promise
        .resolve(user)
        .then(function(user) {
            let foundUser;
            if (foundUser = findCompanyUser(user)) {
                result.duplicatingUser = foundUser;
                // result.errors.push(extend(new Error('Duplicating user'), { name: 'UsersCsvImport.DuplicatingUser' }))
                throw extend(new Error('Duplicating user'), { name: 'UsersCsvImport.DuplicatingUser' });
            }
            return user.validate();
        })
        .then(function(err) {
            if (err) return result.userValidationError = err;
        })
    ;

    let checks = [checkUser];
    if (document) {
        checks.push(document
            .validate()
            .then(function(err) {
                if (err) return result.documentValidationError = err;
            })
        )
    }
    if (departmentName) {
        result.departmentSpecified = true;
        department = result.foundDepartment = findCompanyDepartment(departmentName);
        if (!department) {
            department = models.Department.build({ entityId: entity.get('id'), name: departmentName });
            checks.push(department
                .validate()
                .then(function(err) {
                    if (err) return result.departmentValidationError = err;
                })
            )
        }
    }
    if (groupName) {
        result.groupSpecified = true;
        group = result.foundGroup = findCompanyGroup(groupName);
        if (!group) {
            result.errors.push(extend(new Error('Group not found'), { name: 'UsersCsvImport.GroupNotFound' }))
        }
        // No async checks required
    }

    return Promise
        .all(checks)
        .then(function() {
            if (result.errors.length
                || result.userValidationError
                || result.documentValidationError
                || result.departmentValidationError
            ) {
                throw extend(new Error('ChecksNotPassed'), { name: 'UsersCsvImport.ChecksNotPassed' });
            }
            let include = [];
            let skipFields = [];
            // department
            if (result.foundDepartment) {
                user.set('departmentId', department.get('id'));// exists
                // user.set('department', department.get())
                skipFields.push('department');
            }
            else if (result.departmentSpecified) {
                user.set('department', department.get({ plain: true }));// we created it
                include.push({ model: models.Department, as: 'department' });
                // entity.departments.push(department);
            }
            // booking group
            if (result.foundGroup) {
                user.set('groupId', group.get('id'));// exists
                // user.set('group', group.get());
                skipFields.push('group')
            }

            let saveFields = diff(Object.keys(user.get()), skipFields);
            // We need to rebuild the instance due possible changed options
            var _user = models.User.build(user.get({ plain: true }), { include: include });
            return !config.save
                ? Promise.resolve(_user)
                : _user
                    .save({ validate: false/*, fields: saveFields*/ })
                    .catch(function(err) {
                        throw extend(new Error('Cannot save user'), {
                            name: 'UsersCsvImport.CantSaveUser',
                            parent: err
                        })
                    })
            ;
        })
        .then(function(user) {
            result.createdUser = user;

            return config.save
                ? models.AclGroup
                    .findAll({ where: { name: aclGroupsNames } })
                    .then((dbAclGroups) => {
                        return user.addAclGroups(dbAclGroups);
                    })
                    .then((addedAclGroups) => user)
                : Promise.resolve(user)
            ;
        })
        .then(function(user) {
            if (result.documentSpecified) {
                let promise = !config.save
                    ? Promise.resolve(document)
                    : document
                        .save()
                        .then(function(document) {
                            return document.setUser(user).then(function(users) { return document });
                        })
                ;

                return promise
                    .then(function(savedDocument) {
                        result.createdDocument = savedDocument;
                        return user;
                    })
                ;
            }
            return user;
        })
        .then(function(user) {
            if (result.departmentSpecified) {
                if (!result.foundDepartment) {
                    let promise = !config.save
                        ? Promise.resolve(department)
                        : department
                            .save()
                            .then(function(department) {
                                return user
                                    .setDepartment(department)
                                    .then(function(user) {
                                        return department;
                                    });
                            })
                    ;

                    return promise
                        .then(function(savedDepartment) {
                            result.createdDepartment = savedDepartment;
                            // Put it to the company to be able find it in next cycles
                            entity.departments.push(savedDepartment);
                            return result;
                        })
                    ;
                }
            }
            return result;
        })
        .catch({ name: 'UsersCsvImport.ChecksNotPassed' }, function(err) {
            // result.errors.push(err);
            return result;
        })
        .catch(function(err) {
            console.error(err.stack);
            console.dir(err, { depth: 5, colors: true });
            console.log('processRecord, error', pick(['lastName', 'firstName'], record));
            result.errors.push(err);
            return result;
        })
    ;
}

function extractDocumentData(record) {
    let data = {};
    Object
        .keys(record)
        .filter((key) => String(key).startsWith('doc_'))
        .forEach((key) => { data[key.substr(4)] = record[key] })
    ;
    return data;
}

function extractPermData(record) {
    let data = {};
    Object
        .keys(record)
        .filter((key) => String(key).startsWith('perm_'))
        .forEach((key) => { data[key.substr(5)] = toBoolean(record[key]); })
    ;
    return data;


    function toBoolean(val) {
        if (val === undefined) {
            return false;
        }
        val = String(val).trim().toLowerCase();
        return val === 'да' ? true : false;
    }
}

function extractUserData(record) {
    return pick(
        Object
            .keys(record)
            .filter((key) => { return !String(key).startsWith('doc_') && !String(key).startsWith('perm_') })
        ,
        record
    );
}

function normalize(record) {
    let doc_types = {
        'в': 'passport',
        'з': 'foreign_passport'
    };
    let doc_genders = {
        'м': 'm',
        'ж': 'f'
    };
    if (doc_types[record.doc_type]) {
        record.doc_type = doc_types[record.doc_type];
    }
    if (doc_genders[record.doc_gender]) {
        record.doc_gender = doc_genders[record.doc_gender];
    }

    let fromFormat = 'YYYY-MM-DD';
    let toFormat = 'YYYY-MM-DD';
    record.birthday = record.birthday ? moment(record.birthday, fromFormat).toDate() : null;
    record.doc_issueDate = record.doc_issueDate ? moment(record.doc_issueDate, fromFormat).toDate() : null;
    record.doc_expirationDate = record.doc_expirationDate ? moment(record.doc_expirationDate, fromFormat).toDate() : null;

    return record;
}
