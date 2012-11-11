module.exports = process.env.JSFTP_COV
  ? require('./lib-cov/jsftp')
  : require('./lib/jsftp');
