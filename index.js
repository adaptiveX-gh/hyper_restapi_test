// api/index.js
const serverlessExpress = require('@vendia/serverless-express');
const app = require('../server');

module.exports = serverlessExpress({ app });