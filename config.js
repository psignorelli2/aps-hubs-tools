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

'use strict'; // http://www.w3schools.com/js/js_strict.asp

module.exports = {

    // this this callback URL when creating your client ID and secret
    callbackURL: process.env.APS_CALLBACK_URL || 'http://localhost:3000/callback/oauth',

    // set enviroment variables or hard-code here
    credentials: {
        client_id: process.env.APS_CLIENT_ID || 'o0z14E9cNwTyMJhDvaeJBOo0II9JXEOYG0FPpOB263LYzRFu',
        client_secret: process.env.APS_CLIENT_SECRET || '3A0VgxAHGOgzG27fuAEDhBV0ZkrJ3bAjeGEbEMUAGaCKR7Hnd4W5AVa2tmfUhMGn'
    },

    // Required scopes for your application on server-side
    scopeInternal: [
        'viewables:read', 'data:read', 'data:write', 'data:create', 'data:search'
    ],
    // Required scope of the token sent to the client
    scopePublic: ['viewables:read'],
    sessionSecret: process.env.SERVER_SESSION_SECRET || 'your_secret_key'
};