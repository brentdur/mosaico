"use strict";
/* global module: false, console: false, __dirname: false, process: false */

var express = require('express');
var upload = require('jquery-file-upload-middleware');
var bodyParser = require('body-parser');
var fs = require('fs');
var _ = require('lodash');
var app = express();
var gm = require('gm').subClass({imageMagick: true});
var config = require('../server-config.js');
var extend = require('util')._extend;
var mongoose = require('mongoose');
mongoose.connect('mongodb://localhost/test-tan-mosaico');
var Template = mongoose.model('Template', { 
  hash: String,
  metadata: String,
  content: String,
  html: String
});

app.use(require('connect-livereload')({ ignore: [/^\/dl/] }));
// app.use(require('morgan')('dev'));

app.use(bodyParser.json({limit: '5mb'}));
app.use(bodyParser.urlencoded({     // to support URL-encoded bodies
  limit: '5mb',
  extended: true
})); 

var listFiles = function (req, options, callback) {

    var files = [];
    var counter = 1;
    var finish = function () {
        if (!--counter)
            callback(files);
    };

    var uploadHost = req.protocol + '://' + req.get('host');

    fs.readdir(options.uploadDir, _.bind(function (err, list) {
        _.each(list, function (name) {
            var stats = fs.statSync(options.uploadDir + '/' + name);
            if (stats.isFile()) {
                var file = {
                    name: name,
                    url: uploadHost + options.uploadUrl + '/' + name,
                    size: stats.size
                };
                _.each(options.imageVersions, function (value, version) {
                    counter++;
                    fs.exists(options.uploadDir + '/' + version + '/' + name, function (exists) {
                        if (exists)
                            file.thumbnailUrl = uploadHost + options.uploadUrl + '/' + version + '/' + name;
                        finish();
                    });
                });
                files.push(file);
            }
        }, this);
        finish();
    }, this));
}; 

var uploadOptions = {
  tmpDir: '.tmp',
  uploadDir: './uploads',
  uploadUrl: '/uploads',
  imageVersions: { thumbnail: { width: 90, height: 90 } }
};

app.get('/upload/', function(req, res) {
    listFiles(req, uploadOptions, function (files) {
      res.json({ files: files });
    }); 
});

app.use('/upload/', upload.fileHandler(uploadOptions));

// imgProcessorBackend + "?src=" + encodeURIComponent(src) + "&method=" + encodeURIComponent(method) + "&params=" + encodeURIComponent(width + "," + height);
app.get('/img/', function(req, res) {

    var params = req.query.params.split(',');

    if (req.query.method == 'placeholder') {
        var out = gm(params[0], params[1], '#707070');
        res.set('Content-Type', 'image/png');
        var x = 0, y = 0;
        var size = 40;
        // stripes
        while (y < params[1]) {
            out = out
              .fill('#808080')
              .drawPolygon([x, y], [x + size, y], [x + size*2, y + size], [x + size*2, y + size*2])
              .drawPolygon([x, y + size], [x + size, y + size*2], [x, y + size*2]);
            x = x + size*2;
            if (x > params[0]) { x = 0; y = y + size*2; }
        }
        // text
        out = out.fill('#B0B0B0').fontSize(20).drawText(0, 0, params[0] + ' x ' + params[1], 'center');
        out.stream('png').pipe(res);

    } else if (req.query.method == 'resize') {
        // NOTE: req.query.src is an URL but gm is ok with URLS: otherwise we would have to urldecode the path part of the URL
        var ir = gm(req.query.src);
        ir.format(function(err,format) {
            if (!err) res.set('Content-Type', 'image/'+format.toLowerCase());
            ir.autoOrient().resize(params[0] == 'null' ? null : params[0], params[1] == 'null' ? null : params[1]).stream().pipe(res);
        });

    } else if (req.query.method == 'cover') {
        // NOTE: req.query.src is an URL but gm is ok with URLS: otherwise we would have to urldecode the path part of the URL
        var ic = gm(req.query.src);
        ic.format(function(err,format) {
            if (!err) res.set('Content-Type', 'image/'+format.toLowerCase());
            ic.autoOrient().resize(params[0],params[1]+'^').gravity('Center').extent(params[0], params[1]+'>').stream().pipe(res);
        });

    }

});

app.post('/dl/', function(req, res) {
    var response = function(source) {
        
        if (req.body.action == 'download') {
            res.setHeader('Content-disposition', 'attachment; filename=' + req.body.filename);
            res.setHeader('Content-type', 'text/html');
            res.write(source);
            res.end();
        } else if (req.body.action == 'email') {
            var nodemailer = require('nodemailer');
            var transporter = nodemailer.createTransport(config.emailTransport);

            var mailOptions = extend({
                to: req.body.rcpt, // list of receivers
                subject: req.body.subject, // Subject line
                html: source // html body
            }, config.emailOptions);

            transporter.sendMail(mailOptions, function(error, info){
                if (error) {
                    console.log(error);
                    res.status(500).send('Error: '+error);
                    res.write('ERR');
                } else {
                    console.log('Message sent: ' + info.response);
                    res.send('OK: '+info.response);
                }
            });
        }
        
    };

    response(req.body.html);
});

app.get('/list', function(req, res) {
    // get all objects and return them
    Template.find({}, 'hash', function(err, objs){
      return res.json(objs);
    });
});

var content;
var metadata;
var html;
app.post('/save', function(req, res) {    
    var response = function(temp){
      temp.save(function(err, obj){
        if (err){res.json(err);}
        return res.json({hash:id});
      });
      fs.writeFileSync('saved.json', JSON.stringify([metadata, content]));
    };
    
    // save object
    var id = req.body.hash;
    content = req.body.content;
    metadata = req.body.metadata;
    html = req.body.html;
    
    //TODO: ?? edit metadata.key to equal hash ??
    if (!id || id === 'master'){
      // generate random id
      id = Math.random().toString(36).substr(2, 7);
      var template = new Template({
        hash:id,
        content:JSON.stringify(content),
        metadata:JSON.stringify(metadata),
        html: JSON.stringify(html)
      });
      return response(template);
    } else {
      id = req.body.hash;
      Template.findOne({hash:id}, function(err, obj){
        if (err) {res.send(err);}
        obj.content = JSON.stringify(content);
        obj.metadata = JSON.stringify(metadata);
        obj.html = JSON.stringify(html);
        return response(obj);
      });
    }
});

app.post('/load', function(req, res) {
    if (req.body.hash === 'master') {
        res.json(JSON.parse(fs.readFileSync('saved_master.json', 'utf8')));
    } else {
        // load from id
        Template.findOne({hash:req.body.hash},function(err, obj){
          if (err || !obj){
            return res.json(JSON.parse(fs.readFileSync('saved.json', 'utf8')));
          }
          return res.json([JSON.parse(obj.metadata), JSON.parse(obj.content)]);
        });
    }
});

app.post('/generate', function(req, res) {
  if (req.query.id) {
    Template.findOne({hash:req.query.id}, function(err, obj){
      var html = JSON.parse(obj.html);
      for (var tag in req.body) {
      	html = html.replace('[' + tag + ']', req.body[tag]);
      }
      res.setHeader('Content-disposition', 'attachment; filename=' + 'email.html');
      res.setHeader('Content-type', 'text/html');
      res.write(html);
      res.end();
    });
  } else {
  	res.send(400);
  }
});


// This is needed with grunt-express-server (while it was not needed with grunt-express)

var PORT = process.env.PORT || 3000;

app.use(express.static(__dirname + '/../'));

var server = app.listen( PORT, function() {
    console.log('Express server listening on port ' + PORT);
} );

// module.exports = app;
