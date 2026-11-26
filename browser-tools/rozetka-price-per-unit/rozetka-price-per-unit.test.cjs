const assert = require('node:assert/strict');
const { test } = require('node:test');
const { findQuantityInTitleForTypedUnit: quantity } = require('./Rozetka_Price_per_Unit.user.js');

test('reads quantities in the typed unit, multipacks and counted words', () => {
  assert.equal(quantity('SSD диск Kingston NV3 1TB M.2 2280 NVMe PCIe 4.0 x4 (SNV3S/1000G)', 'GB'), 1000);
  assert.equal(quantity('Kingston Fury 32GB (2x16GB) DDR5', 'гб'), 32);
  assert.equal(quantity('Вода мінеральна Моршинська 6 шт х 1,5 л', 'л'), 9);
  assert.equal(quantity('Вода Моршинська 1.5 л x 6 шт', 'мл'), 9000);
  assert.equal(quantity('Вода Моршинська 1.5 л x 6 шт', 'шт'), 6);
  assert.equal(quantity('Туалетний папір Zewa 8 рулонів', 'рулон'), 8);
  assert.equal(quantity('Павербанк Xiaomi 20000 mAh', 'mAh'), 20000);
  assert.equal(quantity('Смартфон 8/256GB', 'г'), null);
  assert.equal(quantity('Кава в зернах 1 кг', 'г'), 1000);
  assert.equal(quantity('Набір пива Ципа №2 12 банок 5-7,9% 0,5 л', 'л'), 6);
  assert.equal(quantity('Пиво Krombacher Pils 4.8% 5 л', 'л'), 5);
  assert.equal(quantity('Туалетний папір 8 рулонів по 150 м', 'м'), 1200);
  assert.equal(quantity('Без кількості', 'GB'), null);
});
