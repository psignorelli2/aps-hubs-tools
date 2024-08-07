/////////////////////////////////////////////////////////////////////
// Copyright (c) Autodesk, Inc. All rights reserved
// Written by Autodesk Partner Development
//
// Permission to use, copy, modify, and distribute this software in
// object code form for any purpose and without fee is hereby granted,
// provided that the above copyright notice appears in all copies and
// that both that copyright notice and the limited warranty and
// restricted rights notice below appear in all supporting
// documentation.
//
// AUTODESK PROVIDES THIS PROGRAM "AS IS" AND WITH ALL FAULTS.
// AUTODESK SPECIFICALLY DISCLAIMS ANY IMPLIED WARRANTY OF
// MERCHANTABILITY OR FITNESS FOR A PARTICULAR USE.  AUTODESK, INC.
// DOES NOT WARRANT THAT THE OPERATION OF THE PROGRAM WILL BE
// UNINTERRUPTED OR ERROR FREE.
/////////////////////////////////////////////////////////////////////

const express = require('express');
const session = require('cookie-session');
var config = require('./config');
const cookieParser = require('cookie-parser');
const path = require('path');

if (config.credentials.client_id == null || config.credentials.client_secret == null) {
  console.warn('*****************\nWARNING: Client ID & Client Secret not defined as environment variables.\n*****************');
  return;
}

let app = express();

app.use(express.static('public'));

app.set('trust proxy', 1);

app.use(cookieParser());

app.set('port', process.env.PORT || 3000);

app.use(session({
  secret: config.sessionSecret,
  maxAge: 1000 * 60 * 60 // 1 hours to expire the session and avoid memory leak
}));
app.use(express.json({ limit: '50mb' }));
app.use('/', require('./routes/oauth')); // redirect oauth API calls
app.use('/dm', require('./routes/data.management')); // redirect our Data Management API calls
app.use('/md', require('./routes/model.derivative')); // redirect our Data Management API calls

app.listen(app.get('port'), function () {
  console.log('Server listening on port ' + app.get('port'));
});