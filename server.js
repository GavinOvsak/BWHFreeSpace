// server.js
require('dotenv').config();

var express = require('express');
var app = express();
var port = process.env.PORT || 3306;

var http = require('http').Server(app);
var io = require('socket.io')(http);
var cors = require('cors');
var fs = require('fs');
var _ = require('lodash');

app.use(require('cookie-parser')());
var bodyParser = require('body-parser');
app.use(bodyParser.json()); // support json encoded bodies
app.use(bodyParser.urlencoded({ extended: true })); // support encoded bodies

var mongoURL = process.env.MONGODB_URI;
var mongoose = require('mongoose');
mongoose.connect(mongoURL, { 
  useUnifiedTopology: true, useNewUrlParser: true, useFindAndModify: false
});
var db = mongoose.connection;
mongoose.Promise = global.Promise;
var File = mongoose.model('files', mongoose.Schema({ name: String, content: String }));
var session = require('express-session');
var MongoDBStore = require('connect-mongodb-session')(session);

var store = new MongoDBStore({
  uri: mongoURL, collection: 'mySessions'
});

store.on('error', function(error) {
  console.log('mongostore error', error);
});

var sessionOpts = {
  secret: 'spot',
  cookie: {
    maxAge: 1000 * 60 * 60 * 24 // 1 day
  },
  resave: true,
  saveUninitialized: true,
  store: store
};
var sessionMiddleware = session(sessionOpts);
io.use(function(socket, next){
  sessionMiddleware(socket.request, {}, next);
});
app.use(sessionMiddleware);
app.set('view engine', 'ejs');

var dbFileList = [
  'spaceList.js'
];

var hostFiles = [
  'data/spaceList.js',
  'favicon.png',
  'favicon.ico',
];

var reload = function(file) {
  delete require.cache[require.resolve(file)];
  return require(file);
};
var buffers = {};

var ready = function() {
  var spaceList = reload('./data/spaceList.js');

  var makeFile = function(fileName, fileData) {
    var newFile = 'var '+fileName+' = \n';
    newFile += JSON.stringify(fileData, null, 1);
    newFile += "; \nif (typeof window === 'undefined') { module.exports = "+fileName+";}";
    return newFile;
  }

  var saveDefs = function(defs, file) {
    clearTimeout(buffers[file]);
    buffers[file] = setTimeout(function() {
      console.log('saving ' + file + '.js');
      var newFile = makeFile(file, defs);
      fs.writeFileSync('./data/'+file+'.js', newFile);
      File.findOneAndUpdate({name: file+'.js'}, {
        name: file+'.js',
        content: newFile
      }, { upsert: true }, function(err, doc) {
        if (err) console.log('err', err);
      });
    }, 2000);
  };

  function nocache(req, res, next) {
    res.header('Cache-Control', 'private, no-cache, no-store, must-revalidate');
    res.header('Expires', '-1');
    res.header('Pragma', 'no-cache');
    next();
  }

  hostFiles.map(function(hostFile) {
    app.get('/' + hostFile, nocache, function(req, res) {
      res.sendFile(__dirname + '/' + hostFile);
    });
  });

  app.use(cors());
  app.get('/', function(req, res) {
    res.render('home', {
      edit: false
    });
  });
  app.get('/editSpaces', function(req, res) {
    res.render('home', {
      edit: true
    });
  });

  app.get('/spot/:dId', function(req, res) {
    // Make sure user has access
    var reqId = req.params.dId;

    var allSpots = {};
    for (var sId in spaceList) for (var dId in spaceList[sId].spots) allSpots[dId] = sId;

    if (allSpots[reqId] == null) res.redirect('/');
    else {
      res.render('spot', {
        dId: reqId,
        sId: allSpots[reqId]
      });
    }
    console.log('spot', allSpots[reqId], reqId);
  });

  app.use(nocache);
  app.use('/res', express.static('./res'));

  var clients = {};
  io.on('connection', function(socket) {

    var client = new stream(function(inCallback) {
      socket.on('message', inCallback);
    }, function(outMessage) {
      socket.emit('message', outMessage);
    });

    /**
     * Update booking, spot, or space. // Treat bookings as a list of one for now.
     */

    client.listen('updateBooking', function(data, callbackNum) {
      console.log('updateBooking', data);

      var space = spaceList[data.sId];
      if (space == null) return;

      var spot = space.spots[data.dId];
      if (spot == null) return;

      if (data.def.bookings != null) {
        spot.bookings = data.def.bookings
        io.emit('update', spaceList);
        saveDefs(spaceList, 'spaceList');
      }
    });

    client.listen('hello', function() {
      return spaceList;
    });

    client.listen('updateSpot', function(data, callbackNum) {
      console.log('updateSpot', data);

      var space = spaceList[data.sId];
      if (space == null) return;

      var allSpots = {};
      for (var sId in spaceList) for (var dId in spaceList[sId].spots) allSpots[dId] = {sId: sId, spot: spaceList[sId].spots[dId]};

      console.log(space, data);

      if (data.dId == null) {
        if (data.def != null) { // Making a new spot
          var newId = getNewId(allSpots, 'd');
          space.spots[newId] = {
            id: newId,
            name: data.def.name,
            bookings: []
          };
          io.emit('update', spaceList);
        }
      } else if (space.spots[data.dId] != null) {
        if (data.def == null) { // deleting
          delete space.spots[data.dId];
          io.emit('update', spaceList);
        } else { // updating
          ['name', 'bookings'].map(function(key) {
            if (data.def[key] != null) space.spots[data.dId][key] = data.def[key]
          })
          io.emit('update', spaceList);
        }
      }
      saveDefs(spaceList, 'spaceList');
    });

    client.listen('updateSpace', function(data, callbackNum) {
      console.log('updateSpace', data);
      if (data.sId == null) {
        if (data.def != null) { // Making a new space
          var newId = getNewId(spaceList, 's');
          spaceList[newId] = {
            id: newId,
            name: data.def.name,
            description: '',
            link: '',
            spots: {}
          };
          io.emit('update', spaceList);
        }
      } else if (spaceList[data.sId] != null) {
        if (data.def == null) { // deleting
          delete spaceList[data.sId];
          io.emit('update', spaceList);
        } else { // updating
          ['name', 'description', 'link', 'spots'].map(function(key) {
            if (data.def[key] != null) spaceList[data.sId][key] = data.def[key]
          })
          io.emit('update', spaceList);
        }
      }
      saveDefs(spaceList, 'spaceList');
    });

    client.listen('log', function(data) {
      console.log('log - ' + (typeof data === 'string' ? data : JSON.stringify(data)));
    });

    var socket_id = socket.id;
    clients[socket_id] = client;
  });

  http.listen(port, function() {
    console.log('listening on *:' + port);
  });
};

db.once('open', function() {
  var fileCursor = File.find({}).cursor();
  fileCursor.on('data', function(file) {
    if (dbFileList.indexOf(file.name) == -1) return;
    console.log('Found ', file.name);
    fs.writeFileSync('./data/' + file.name, file.content);
  });
  fileCursor.on('end', function() {
    console.log('done!');
    ready();
  })
});

function stream(setIn, outCallback, opts) {
  opts = opts || {}; // Can log time lengths for callbacks

  var listeners = {};
  var lastCallbackNum = 0;
  var that = this;
  this.send = function(label, data, opt_callback, opt_idCallback) {
    lastCallbackNum++;
    if (_.isFunction(data)) { // Can skip the data field if no interesting data to send
      opt_callback = data;
      data = {};
    }
    if (opt_idCallback != null) opt_idCallback(lastCallbackNum);
    if (opt_callback != null) listeners[lastCallbackNum] = [{callback: opt_callback, sendTime: performance.now()}];
    if (_.isFunction(label)) {
      label(data);
    } else {
      outCallback({
        label: label, data: data,
        callbackNum: opt_callback != null ? lastCallbackNum : null
      }); 
    }
  };

  this.listen = function(label, callback) {
    listeners[label] = listeners[label] || [];
    listeners[label].push({callback: callback});
  }

  setIn(function(message) {
    if (listeners[message.label] == null) return;
    for (var i = 0; i < listeners[message.label].length; i++) {
      var response = listeners[message.label][i].callback(message.data, message.callbackNum);
      if (response != null && message.callbackNum != null) {
        that.send(message.callbackNum, response);
      }
    }
  });
};

function getNewId(list, prefix) {
  var id = null;
  var outOf = (Object.keys(list).length + 1) * 50;
  while (id == null || list[prefix + id] != null) id = Math.round(Math.random() * outOf);
  return prefix + id;
};