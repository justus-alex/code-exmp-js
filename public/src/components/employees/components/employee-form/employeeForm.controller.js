'use strict';

import cloneDeep from 'lodash/cloneDeep';
import assign from 'lodash/assign';
import _ from 'lodash';

class EmployeeFormController {
    /* @ngInject */
    constructor(
        $scope,
        moment,
        $mdSelect,
        ACL_CONSTANTS,
        $filter,
        AnchorScrollService,
        CardApiService,
        $mdDialog
    ) {
        let _this = this;

        _this.$scope = $scope;
        _this.ACL = ACL_CONSTANTS;
        _this.moment = moment;
        _this.$mdSelect = $mdSelect;
        _this.$filter = $filter;
        _this.AnchorScrollService = AnchorScrollService;
        _this.autocomplete = _this.autocomplete || 'off';
        _this.CardApiService = CardApiService;
        _this.$mdDialog = $mdDialog;
    }

    /**
     * We expect employee and company objects bound to the controller
     */
    $onInit() {
        let _this = this;
        let ACL = _this.ACL;

        _this.currentDate = _this.moment().startOf('day');
        _this.companyType = _this.company.contract.type;
        _this._employee = prepareEmployee(cloneDeep(_this.employee));
        _this._employee.aclGroups = _this._employee.aclGroups || [];
        _this._employee.documents = _this._employee.documents || [];
        _this._employee.bonusCards = _this._employee.bonusCards || [];
        _this._company = cloneDeep(_this.company);
        _this.employeeAclGroups = getCompanyTypeAclGroups(_this.companyType);

        if (_this._employee.aclGroups.length) {
            for (let group in _this.employeeAclGroups) {
                _this.employeeAclGroups[group] = _this._employee.aclGroups.indexOf(group) > -1;
            }

            if (_this.companyType === _this.CONTRACT_TYPE_CORP) {
                _this.CardApiService.getCards().then((data) => {
                    let cards = data.data ? data.data : [];

                    if (_.isEmpty(cards)) {
                        let alert = _this.$mdDialog.alert({
                            title: 'Внимание',
                            textContent: 'Для того, чтобы включить опцию, добавьте карту в разделе "АККАУНТ"',
                            ok: 'Закрыть'
                        });
                        _this.$scope.$watch(() => _this.employeeAclGroups[ACL.GROUP.CORP_CARD_PAYER], (newVal, oldVal) => {
                            if (
                                newVal == true
                                && newVal != oldVal
                                && !_.isUndefined(newVal)
                                && !_.isUndefined(oldVal)
                            ) {
                                _this.$mdDialog
                                    .show( alert )
                                    .finally(function() {
                                        _this.employeeAclGroups[ACL.GROUP.CORP_CARD_PAYER] = false;
                                    });
                            }
                        });
                    }

                });
            }
        }

        function getCompanyTypeAclGroups(type) {
            let groups = {};

            groups[ACL.GROUP.ORDER_CREATOR] = false;
            if (type === _this.CONTRACT_TYPE_CORP) {
                groups[ACL.GROUP.OTHER_EMPLOYEES_ORDER_CREATOR] = false;
                groups[ACL.GROUP.CORP_CARD_PAYER] = false;
            }
            groups[ACL.GROUP.FINANCIAL_REPORT_VIEWER] = false;

            return groups;
        }

        function prepareEmployee(employeeData) {
            let dflt = {
                isActive: true
            };
            employeeData = assign(dflt, employeeData);
            normalizeDateField(employeeData, 'birthday');
            (employeeData.documents || []).forEach(function(document) {
                normalizeDateField(document, 'issueDate');
                normalizeDateField(document, 'expirationDate');
                let virtFields = ['firstName', 'lastName', 'middleName', 'fullName', 'fullName_loc', 'fullName_int'];
                virtFields.forEach(function(field) {
                    delete document[field];
                });
            });

            if (employeeData.group) {
                employeeData.groupId = employeeData.group.id;
            }

            if (employeeData.department && employeeData.department.id) {
                let selectedDepartmets = _this.company.departments.filter((d) => {
                    return d.id === employeeData.department.id;
                });

                employeeData.department = selectedDepartmets[0];
            }

            return employeeData;

            // TODO: consider moving date transformation to the API layer
            function normalizeDateField(obj, field) {
                const moment = _this.moment;
                // We expect date fields in ISO 8601 format and with zero timezone offset from the API after JSON.stringify.
                let md;
                if (obj[field] && (md = moment(obj[field])).isValid()) {
                    obj[field] = md.format('DD.MM.YYYY');
                } else {
                    obj[field] = null;
                }
            }
        }
    }

    addBonusCard() {
        let _this = this;

        _this._employee.bonusCards.push({});
    }

    removeBonusCard(index) {
        let _this = this;
        let bonusCard = _this._employee.bonusCards[index];

        if(bonusCard) {
            _.remove(_this._employee.bonusCards, bonusCard);
        }
    }

    addDocument() {
        const _this = this;

        let dflt = {
            isActive: true,
            number: ''
        };
        _this._employee.documents.push(dflt);
    }

    removeDocument(index) {
        const _this = this;

        if (_this._employee.documents[index]) {
            _this._employee.documents.splice(index, 1);
        }
    }

    isEmailValid() {
        let _this = this;
        let isCorrect = false;

        if(_this._employee.email) {
            let emailPattern = /^[_a-z0-9]+([\.\-]?[_a-z0-9]+)*@[a-z0-9-]+([\.\-]?[_a-z0-9]+)*(\.[a-z]{2,4})$/;
            isCorrect = emailPattern.test(_this._employee.email);

            _this.form.email.$error.invalid = !isCorrect;
            _this.form.email.$setValidity("invalid", !(!isCorrect));
        }

        return isCorrect;
    }

    isBirthdayValid() {
        let _this = this;
        let isCorrect = false;

        if(_this._employee.birthday) {
            let employeeBirthday = _this.moment(_this._employee.birthday, 'DD.MM.YYYY');
            isCorrect = employeeBirthday.isSameOrBefore(_this.currentDate);

            _this.form.birthday.$error.dateRangeMax = !isCorrect;
            _this.form.birthday.$setValidity("dateRangeMax", !(!isCorrect));
        }

        return isCorrect;
    }

    validateEmployeeData() {
        let _this = this;

        if(_.isEmpty(_this.form.$error)) {
            return true;
        }

        let errorType = _.sample(_this.form.$error);
        let formField = _.first(errorType);
        let field = _.first(formField.$name.split("_"));

        switch(field) {
            case 'bonusCard':
            case 'document':
                _this.AnchorScrollService.scrollTo(
                    `[ng-form='${formField.$name}']`,
                    250,
                    0,
                    '.employees-page .ott-sidenav-right'
                );
                break;
            default:
                _this.AnchorScrollService.scrollTo(
                    '#personal-data-section',
                    250,
                    0,
                    '.employees-page .ott-sidenav-right'
                );
                break;
        }

        return false;
    }

    /**
     * Propogates $submitted state to it's children document forms. $setPrisine() does this (propogation) by default.
     */
    submit() {
        let _this = this;
        let filteredGroup = [];
        _.each(this.employeeAclGroups, (val, group) => {
            if (val) {
                filteredGroup.push(group);
            }
        });
        _this._employee.aclGroups = filteredGroup;
        _this.$scope.$broadcast('employee-form:submit');
        let i = 0;
        while (_this.form['document_' + i] !== undefined) {
            _this.form['document_' + i++].$setSubmitted();
        }

        i = 0;
        while(_this.form['bonusCard_' + i] !== undefined) {
            _this.form['bonusCard_' + i].$setSubmitted();
            i++;
        }

        if(!_this.validateEmployeeData()) {
            return;
        }

        let employeeData = cloneDeep(_this._employee);
        normalizeDateField(employeeData, 'birthday');
        (employeeData.documents || []).forEach(function(document) {
            if (document.type === 'foreign_passport') {
                delete document.issueDate;
                normalizeDateField(document, 'expirationDate');
            } else {
                delete document.expirationDate;
                normalizeDateField(document, 'issueDate');
            }

            let virtFields = ['firstName', 'lastName', 'middleName', 'fullName', 'fullName_loc', 'fullName_int'];
            virtFields.forEach(function(field) {
                delete document[field];
            });
        });

        // We should get this callback from the bindings
        return _this.onSubmit({ employee: employeeData });

        function normalizeDateField(obj, field) {
            const moment = _this.moment;
            // Format date fields back. It should be valid here
            let md;
            if (obj[field] && (md = moment(obj[field], 'DD.MM.YYYY')).isValid()) {
                obj[field] = md.format('YYYY-MM-DD');
            } else {
                obj[field] = null;
            }
        }
    }

    cancel() {
        const _this = this;

        // We should get this callback from the bindings
        return _this.onCancel({ employee: _this._employee })
    }

    onDepartmentInputKeydown($event) {
        const _this = this;
        const $mdSelect = _this.$mdSelect;

        $event.stopPropagation();

        let isEnter = $event.key == 'Enter' || ($event.keyCode || $event.which) == 13;
        if (isEnter) {
            let value = _this.form.newDepartment.$modelValue;
            if (value && value.length && _this.form.newDepartment.$valid) {
                addNewDepartment(value);
                _this.newEmployeeDepartment = null;
                // TODO: That's an unobvious dependency.
                // Probably, we should create our own directive if we want to keep this control for creating departments.
                $mdSelect.hide();
            }
        }

        function addNewDepartment(newDepartmentName) {
            let newDepartment = _this._company.departments.find((d) => {
                return !d.id;
            });

            if (!newDepartment) {
                newDepartment = {
                    id: null,
                    name: newDepartmentName
                };

                _this.company.departments.push(newDepartment);
            } else {
                newDepartment.name = newDepartmentName;
            }

            _this._employee.department = newDepartment;
        }
    }
}

EmployeeFormController.CONTRACT_TYPE_COM =
EmployeeFormController.prototype.CONTRACT_TYPE_COM = 'com';

EmployeeFormController.CONTRACT_TYPE_CONC =
EmployeeFormController.prototype.CONTRACT_TYPE_CONC = 'conc';

EmployeeFormController.CONTRACT_TYPE_CORP =
EmployeeFormController.prototype.CONTRACT_TYPE_CORP = 'corp';

export default EmployeeFormController;
