var ftpd = require('ftpd');

var _user = 'user';
var _pass = '12345';

function makeServer(options) {
  var server = new ftpd.FtpServer(options.host, {
    getInitialCwd: function() {
      return options.cwd || '/';
    },
    getRoot: function() {
      return options.root || process.cwd();
    },
    pasvPortRangeStart: 1025,
    pasvPortRangeEnd: 1050,
    tlsOptions: options.tls,
    allowUnauthorizedTls: false,
    useWriteFile: false,
    useReadFile: false,
    uploadMaxSlurpSize: 7000, // N/A unless 'useWriteFile' is true.
  });

  server.on('error', function(error) {
    console.log('FTP Server error:', error);
  });

  server.on('client:connected', function(connection) {
    var username = null;
    console.log('client connected: ' + connection.remoteAddress);
    connection.on('command:user', function(user, success, failure) {
      if (_user === user) {
        username = user;
        success();
      } else {
        failure();
      }
    });

    connection.on('command:pass', function(pass, success, failure) {
      if (_pass === pass) {
        success(username);
      } else {
        failure();
      }
    });
  });

  server.debugging = 4;
  return server;
}

module.exports = {
  makeServer: makeServer
};
