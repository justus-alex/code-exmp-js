'use strict';

const assign = Object.assign || require('lodash/assign');

var map;

module.exports = (function() {
    if (map) return map;

    let lcMap = {
        // lowercase
        "щ": "shch",
        "ш": "sh",
        "ч": "ch",
        "я": "ya",
        "ё": "ye",
        "ю": "yu",
        "а": "a",
        "б": "b",
        "в": "v",
        "г": "g",
        "д": "d",
        "е": "e",
        "ж": "zh",
        "з": "z",
        "и": "i",
        "й": "y",
        "х": "kh",
        "к": "k",
        "л": "l",
        "м": "m",
        "н": "n",
        "о": "o",
        "п": "p",
        "р": "r",
        "ц": "ts",
        "с": "s",
        "т": "t",
        "у": "u",
        "ф": "f",
        "ь": "",
        "ы": "y",
        "ъ": "",
        "э": "e",
    };
    let ucMap = {};
    for (let key in lcMap) {
        ucMap[key.toUpperCase()] = lcMap[key].toUpperCase();
    }
    map = assign(lcMap, ucMap);
    return map;
})();
