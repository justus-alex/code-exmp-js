'use strict';

var extend = require('util')._extend;
var aclConstants = require('../../lib/aclConstants');

var helper = extend({}, aclConstants);


helper.hasGroup = function (user, group) {
    return user
        .getAclGroupNames()
        .then((aclGroupNames) => {
            return aclGroupNames.indexOf(group) > -1;
        });
};

helper.hasGroups = function (user, groups) {
    var groupList = Array.isArray(groups) ? groups : [groups];

    return user
        .getAclGroupNames()
        .then((userAclGroups) => {
            return groupList.every((item) => {
                return userAclGroups.indexOf(item) > -1;
            });
        });
};

helper.hasPermission = function (user, permission) {
    return user
        .getPermissions()
        .then((userPermissions) => {
            return userPermissions.indexOf(permission) > -1;
        });
};

helper.hasPermissions = function(user, permissions) {
    var permissionList = Array.isArray(permissions) ? permissions : [permissions];

    return user
        .getPermissions()
        .then((userPermissions) => {
            return permissionList.every((item) => {
                return userPermissions.indexOf(item) > -1;
            });
        });
};

helper.hasSomePermission = function(user, permissions) {
    var permissionList = Array.isArray(permissions) ? permissions : [permissions];

    return user
        .getPermissions()
        .then((userPermissions) => {
            return permissionList.some((item) => {
                return userPermissions.indexOf(item) > -1;
            });
        });
};


module.exports = helper;
