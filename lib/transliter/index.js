// based on github/eldargab/translit
'use strict';

const assign = Object.assign || require('lodash/assign');

module.exports = function(map, reverse) {
    !map && (map = require('./maps/ru-en.b2b'));
    reverse = Boolean(reverse);
    reverse && (map = reverseMap(map));

    var keys = Object.keys(map).sort(function(a, b) {
        return b.length - a.length
    }).filter(function(key) { return key.length > 0; });

    function peek(str) {
        for (let i = 0; i < keys.length; i++) {
            if (startsWith(keys[i], str)) return keys[i];
        }
        return null;
    }

    return function(str) {
        var out = '';
        while (str) {
            var key = peek(str);
            if (key) {
                out += map[key];
                str = str.slice(key.length);
            } else {
                out += str[0];
                str = str.slice(1);
            }
        }
        return out;
    }
}

function reverseMap(map) {
    let reversed = {};
    for (let key in map) {
        reversed[map[key]] = key;
    }
    return reversed;
}

function startsWith(start, str) {
    for (var i = 0; i < start.length; i++) {
        if (start[i] != str[i]) return false
    }
    return true
}

function sortMapKeys(map) {
    return Object.keys(map).sort(function(a, b) {
        return b.length - a.length
    });
}
