var Utils = module.exports = {
  getPasvPort: function(text) {
    var RE_PASV = /([-\d]+,[-\d]+,[-\d]+,[-\d]+),([-\d]+),([-\d]+)/;
    var match = RE_PASV.exec(text);
    if (!match) return false;

    // Array containing the passive host and the port number
    return [match[1].replace(/,/g, "."),
      (parseInt(match[2], 10) & 255) * 256 + (parseInt(match[3], 10) & 255)];
  },

  /**
   * Cleans up commands with potentially insecure data in them, such as
   * passwords, personal info, etc.
   *
   * @param cmd {String} Command to be sanitized
   * @returns {String} Sanitized command
   */
  sanitize: function(cmd) {
    if (!cmd) return "";

    var _cmd = cmd.slice(0, 5);
    if (_cmd === "pass ")
      cmd = _cmd + Array(cmd.length - 5).join("*");

    return cmd;
  }
};

