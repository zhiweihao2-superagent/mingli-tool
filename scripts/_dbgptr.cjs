require('../web/ziwei-facts.js');
require('../web/annual-timeline.js');
const Timeline = globalThis.MingliAnnualTimeline;
const fs = require('node:fs');
const src = fs.readFileSync('tests/annual_timeline.test.cjs','utf8');
const start = src.indexOf('function buildBaziMonths');
const end = src.indexOf('function buildZiweiMonths');
const helpers = src.slice(start, end + src.slice(end).indexOf('function okZiweiMonths') > 0 ? 0 : 0);
console.log(typeof Timeline.build);
