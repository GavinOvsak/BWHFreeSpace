// data.js (-download) (-upload)
/**

-download updates local files
-upload uploads files to the database

**/

var dbFileList = [
  'spaceList.js'
];

require('dotenv').config();

var _ = require('lodash');
var fs = require('fs');

var command = process.argv[2];

var mongoURL = '';
var type = '';

if (command == '-download') {
  mongoURL = process.env.MONGODB_URI;
  type = 'download';
} else if (command == '-upload') {
  mongoURL = process.env.MONGODB_URI;
  type = 'upload';
}

if (mongoURL.length == 0) process.exit();

var mongoose = require('mongoose');
mongoose.connect(mongoURL, { 
  useUnifiedTopology: true,
  useNewUrlParser: true,
  useFindAndModify: false
});
var db = mongoose.connection;
mongoose.Promise = global.Promise;

var File = mongoose.model('File', mongoose.Schema({ name: String, content: String }));

var after = function(before, after) {
  before(function() {
    after.apply(null, arguments);
  });
};
  
var for2 = function(opts, func, callback) {
  opts = opts || {}
  
  var done = callback || opts.done || function() {};
  if (opts.list == null) return callback;
  var values = _.values(opts.list);
  var keys = Object.keys(opts.list);
  var blockThreshold = 80;
  var i = 0;
  var checkNext = function() {
    var start = typeof performance != 'undefined' ? performance.now() : 0;
    var stop = false;
    var wait = function() { 
      if (opts.wait != null) opts.wait(); // waiting the upper layers as well
      stop = true; 
    };
    while (i < values.length) {
      if (!opts.block && !stop) {
        var now = typeof performance != 'undefined' ? performance.now() : 0;
        if (now - start > blockThreshold) {
          start = typeof performance != 'undefined' ? performance.now() : 0;
          wait(); // Don't introduce asynchrony without notifying super methods
          setTimeout(checkNext, 0);
          break;
        }
      }
      func(values[i], function(opts) {
        opts = opts || {};
        if (opts.break) {
          stop = true; // easy way to break a loop
          return done();
        }
        if (!stop) return; // Only works when waited first
        if (!opts.sync && !opts.block) { // Default to async to prevent stack traces overflowing
          setTimeout(checkNext, 0);
        } else {
          checkNext();
        }
      }, keys[i], wait);
      i++;
      if (stop) break;
    }
    if (i == values.length && !stop) done();
  };
  checkNext();
};

db.on('error', console.error.bind(console, 'connection error:'));
db.once('open', function() {
  console.log('Connected to the db!');
  if (type == 'download') {
    after(function(done) {
      File.find({}, function(err, files) {
        files.map(function(file) {
          if (dbFileList.indexOf(file.name) == -1) return;
          console.log('Found ', file.name);
          fs.writeFileSync('./data/' + file.name, file.content);        
        })

        console.log('Downloading CVs');
        done();
      });
    }, function() {
      process.exit();
    })
  } else if (type == 'upload') {
    console.log('uploading');
    after(function(done) {
      File.remove({}, function() {      
        threshold = dbFileList.length;
        for2({list: dbFileList}, function(fileName, done, i, wait) {
          wait();
          fs.readFile('./data/' + fileName, function(err, data) {
            console.log('Got', fileName);
            File.findOneAndUpdate({name: fileName}, {
              name: fileName,
              content: data
            }, { upsert:true }, function(err, doc){
              if (err) console.log('err', err);
              console.log('Uploaded ', fileName);
              threshold--;
              done();
            });
          });
        }, function() {
          done();
        })
      });
    }, function() {
      process.exit();
    });
  } else {
    process.exit();
  }
});