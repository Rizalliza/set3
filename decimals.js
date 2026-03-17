// utils/decimals.js
// Decimal utilities using decimal.js

const Decimal = require('decimal.js');

/**
 * Convert any value to Decimal
 */
function toDecimal(v) {
    if (v instanceof Decimal) return v;
    if (v === undefined || v === null) return new Decimal(0);
    return new Decimal(v.toString());
}

module.exports = {
    Decimal,
    toDecimal
};
