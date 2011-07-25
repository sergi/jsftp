/**
 * @package jsFTP
 * @copyright Copyright(c) 2011 Ajax.org B.V. <info AT ajax DOT org>
 * @author Sergi Mansilla <sergi DOT mansilla AT gmail DOT com>
 * @license https://github.com/sergi/jsFTP/blob/master/LICENSE MIT License
 */
// See RFC at http://www.w3.org/Protocols/rfc959

var RE_SERVER_RESPONSE = /^(\d\d\d)(.*)/;

/**
 * this is the regular expression used by Unix Parsers.
 *
 * Permissions:
 *    r   the file is readable
 *    w   the file is writable
 *    x   the file is executable
 *    -   the indicated permission is not granted
 *    L   mandatory locking occurs during access (the set-group-ID bit is
 *        on and the group execution bit is off)
 *    s   the set-user-ID or set-group-ID bit is on, and the corresponding
 *        user or group execution bit is also on
 *    S   undefined bit-state (the set-user-ID bit is on and the user
 *        execution bit is off)
 *    t   the 1000 (octal) bit, or sticky bit, is on [see chmod(1)], and
 *        execution is on
 *    T   the 1000 bit is turned on, and execution is off (undefined bit-
 *        state)
 */

var RE_UnixEntry = new RegExp(
    "([bcdlfmpSs-])"
    + "(((r|-)(w|-)([xsStTL-]))((r|-)(w|-)([xsStTL-]))((r|-)(w|-)([xsStTL-])))\\+?\\s+"
    + "(\\d+)\\s+"
    + "(\\S+)\\s+"
    + "(?:(\\S+)\\s+)?"
    + "(\\d+)\\s+"

    //numeric or standard format date
    + "((?:\\d+[-/]\\d+[-/]\\d+)|(?:\\S+\\s+\\S+))\\s+"

    // year (for non-recent standard format)
    // or time (for numeric or recent standard format)
    + "(\\d+(?::\\d+)?)\\s+"

    //+ "(\\S*)(\\s*.*)"
    + "(.*)"
);

// MSDOS format
// 04-27-00  09:09PM       <DIR>          licensed
// 07-18-00  10:16AM       <DIR>          pub
// 04-14-00  03:47PM                  589 readme.htm
var RE_DOSEntry = new RegExp(
    "(\\S+)\\s+(\\S+)\\s+"
    + "(<DIR>)?\\s*"
    + "([0-9]+)?\\s+"
    + "(\\S.*)"
);

// Not used for now
// var RE_VMSEntry = new RegExp(
//     "(.*;[0-9]+)\\s*"
//     + "(\\d+)/\\d+\\s*"
//     + "(\\S+)\\s+(\\S+)\\s+"
//     + "\\[(([0-9$A-Za-z_]+)|([0-9$A-Za-z_]+),([0-9$a-zA-Z_]+))\\]?\\s*"
//     + "\\([a-zA-Z]*,[a-zA-Z]*,[a-zA-Z]*,[a-zA-Z]*\\)"
// );

var MONTHS = [null, "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

exports.nodeTypes = {
    FILE_TYPE           : 0,
    DIRECTORY_TYPE      : 1,
    SYMBOLIC_LINK_TYPE  : 2,
    UNKNOWN_TYPE        : 3
};

exports.permissions = {
    READ_PERMISSION     : 0,
    WRITE_PERMISSION    : 1,
    EXECUTE_PERMISSION  : 2
};

exports.access = {
    USER_ACCESS  : 0,
    GROUP_ACCESS : 1,
    WORLD_ACCESS : 2
};

var compact = function(array) {
    return array.filter(function(value) { return !!value; });
};


/**
 * Parses standard FTP replies. Please note that this only involves replies in
 * the form of <code> <message>. It doesn't parse file listings or non-standard
 * extensions.
 *
 * @param lines {Array} FTP entries (responses)
 * @returns {Array} Processed entries
 */
exports.parseResponses = function(lines) {
    if (!Array.isArray(lines))
        throw new TypeError("The parameter should be an Array");

    var responses = [];
    compact(lines).map(function(line) {
            var match = line.match(RE_SERVER_RESPONSE);
            match && (line = [parseInt(match[1], 10), match[2]]);
            return line;
        })
        .reduce(function(p, c, i) {
            // If there is a previous line it means that we are inside a multiline
            // server response command, in which case we will add the current
            // line contents to the previous one, but we have to check if the
            // current line is the one that terminates the multiline string, in
            // which case we add its contents and terminate the multiline by
            // returning null.
            if (p) {
                var cIsMultiLine, currentMsg;
                var cIsArray = Array.isArray(c);

                if (cIsArray) {
                    cIsMultiLine = c[1][0] == "-";
                    currentMsg   = c[0] + c[1];
                }
                else {
                    cIsMultiLine = false;
                    currentMsg = c;
                }

                p[1] += "\n" + currentMsg;
                // If the current line is a code/message response, and the code
                // is the same as the previous code and the current line is not
                // a multiline one (in which case it would be treated as any
                // random text).
                if (cIsArray && c[0] == p[0] && !cIsMultiLine) {
                    responses.push(p);
                    return null;
                }
                return p;
            }
            else if (c[1].charAt(0) == "-") {
                return c;
            }
            else {
                responses.push(c);
                return null;
            }
        }, null);

    return responses;
};

exports.processDirLines = function(lines, type) {
    var processed = [];
    var t;
    lines.forEach(function(line) {
        if (line.length) {
            if (type === "LIST") {
                var result = exports.entryParser(line);
                if (result) {
                    var t = typeof result == "string" ? "raw" : "entry";
                    processed.push([t, result, line]);
                }
            }
            //else if (type === 'MLSD')
                //result = parseMList(lines[i], numFields);
        }
    });

    return processed;
};

/**
 * Selects which parser to use depending on the first character of the line to
 * parse.
 *
 * @param entry {String} FTP file entry line
 * @returns {Object} Parsed object with the file entry properties
 */
exports.entryParser = function(entry) {
    var c = entry[0];

    //if c == '+':
    //    return self._parse_EPLF(buf)

    if ('bcdlps-'.indexOf(c) > -1)
        return parsers.unix(entry);

    else if ('0123456789'.indexOf(c) > -1)
        return parsers.msdos(entry);

    else {
        //console.log("Unrecognized format: \n" + entry);
        return null;
    }
};

var parsers = {
    unix: function(entry) {
        var target, writePerm, readPerm, execPerm;
        var group = entry.match(RE_UnixEntry);

        if (group) {
            var type = group[1];
            var hardLinks = group[15];
            var usr = group[16];
            var grp = group[17];
            var size = group[18];
            var date = new Date(group[19] + " " + group[20]).getTime();
            var name = group[21];
            var endtoken = group[22];
        }

        var pos = name.indexOf(' -> ');
        if (pos > -1) {
            name   = name.substring(0, pos);
            target = name.substring(pos + 4);
        }

        switch (type[0]) {
            case 'd':
                type = exports.nodeTypes.DIRECTORY_TYPE;
                break;
            case 'l':
                type = exports.nodeTypes.SYMBOLIC_LINK_TYPE;
                break;
            case 'b':
            case 'c':
                // break; - fall through
            case 'f':
            case '-':
                type = exports.nodeTypes.FILE_TYPE;
                break;
            default:
                type = exports.nodeTypes.UNKNOWN_TYPE;
        }

        var file = {
            name: name,
            type: type,
            time: date,
            size: size,
            owner: usr,
            group: grp
        };

        if (target) file.target = target;

        var g = 4;
        ["user", "group", "other"].forEach(function(access) {
            // Use != '-' to avoid having to check for suid and sticky bits
            readPerm  = group[g] !== "-";
            writePerm = group[g + 1] !== "-";

            var execPermStr = group[g + 2];

            file[access + "Permissions"] = {
                read : readPerm,
                write: writePerm,
                exec : (execPermStr !== "-") && !(/[A-Z]/.test(execPermStr[0]))
            };

            g +=4;
        });

        return file;
    },
    msdos: function(entry) {
        var group = entry.match(RE_DOSEntry);

        function replacer(str, hour, min, ampm, offset, s) {
            return hour + ":" + min + " " + ampm;
        }
        var time = group[2].replace(/(\d{2}):(\d{2})([AP]M)/, replacer);

        if (group) {
            var date = new Date(group[1] + " " + time).getTime();
            var dirString = group[3];
            var size = group[4];
            var name = group[5];

            if (null == name || name === "." || name === "..")
                return null;

            if (dirString === "<DIR>") {
                type = exports.nodeTypes.DIRECTORY_TYPE;
                size = 0;
            }
            else {
                type = exports.nodeTypes.FILE_TYPE;
            }

            return {
                name: name,
                type: type,
                time: date,
                size: size
            }
        }
    }
}

/*
 * MLSx commands are not being used for now.
 *
 * http://rfc-ref.org/RFC-TEXTS/3659/chapter7.html
 * http://www.rhinosoft.com/newsletter/NewsL2005-07-06.asp?prod=rs
 *
var reKV = /(.+?)=(.+?);/;
exports.parseMList = function(line) {
    var ret;
    var result = line.trim().split(reKV);

    if (result && result.length > 0) {
        ret = {};
        if (result.length === 1) {
            ret.name = result[0].trim();
        }
        else {
            var i, k, v, len = result.length;
            for (i = 1; i < len; i += 3) {
                k = result[i];
                v = result[i+1];
                ret[k] = v;
            }
            ret.name = result[result.length-1].trim();
        }
    } else
        ret = line;

    return ret;
}
*/
