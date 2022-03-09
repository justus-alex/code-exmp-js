'use strict';

const assign = Object.assign || require('lodash/assign');

var map;

module.exports = (function() {
    if (map) return map;

    let lcMap = {
        // lowercase
        "shch": "щ",
        "sh": "ш",
        "ch": "ч",
        "ya": "я",
        "yay": "яй",
        "ye": "ё",
        "yu": "ю",
        "a": "а",
        "ay": "ай",
        "b": "б",
        "v": "в",
        "g": "г",
        "d": "д",
        "e": "е",
        "ey": "ей",
        "zh": "ж",
        "z": "з",
        "i": "и",
        "iy": "ий",
        "kh": "х",
        "k": "к",
        "l": "л",
        "m": "м",
        "n": "н",
        "o": "о",
        "oy": "ой",
        "p": "п",
        "r": "р",
        "ts": "ц",
        "s": "с",
        "t": "т",
        "u": "у",
        "uy": "уй",
        "f": "ф",
        "y": "ы",
        "yy": "ый"
    };
    let ucMap = {};
    for (let key in lcMap) {
        ucMap[key.toUpperCase()] = lcMap[key].toUpperCase();
    }
    map = assign(lcMap, ucMap);
    return map;
})();
