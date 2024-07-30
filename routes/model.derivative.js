'use strict'; // http://www.w3schools.com/js/js_strict.asp

// web framework
var express = require('express');
var router = express.Router();
var bodyParser = require('body-parser');
var jsonParser = bodyParser.json();
var apsSDK = require('forge-apis');
var archiver = require('archiver');


/////////////////////////////////////////////////////////////////
// Get the list of export file formats supported by the
// Model Derivative API
/////////////////////////////////////////////////////////////////
router.get('/formats', function (req, res) {
    var derivatives = new apsSDK.DerivativesApi();

    derivatives.getFormats({}, null, req.session.internal)
        .then(function (formats) {
            res.json(formats.body);
        })
        .catch(function (error) {
            res.status(error.statusCode).end(error.statusMessage);
        });
});

router.get('/download', async function (req, res) {
    const pdfurn = req.query.pdfurn;
    const mainUrn = req.query.mainUrn;

    try {
        // Dynamically import fetch
        const { default: fetch } = await import('node-fetch');

        let newDerivativeUrl = await getSignedUrlFromDerivative(mainUrn, pdfurn, req.session.internal);

        // Fetch the file content
        const fileResponse = await fetch(newDerivativeUrl.url, {
            headers: {
                'Cookie': Object.entries(newDerivativeUrl.cookies).map(([key, value]) => `${key}=${value}`).join('; ')
            }
        });

        if (!fileResponse.ok) {
            throw new Error(`HTTP error! status: ${fileResponse.status}`);
        }

        // Set appropriate headers for file download
        res.setHeader('Content-Disposition', `attachment; filename="${newDerivativeUrl.name}"`);
        res.setHeader('Content-Type', 'application/pdf');

        // Pipe the response directly to the client
        fileResponse.body.pipe(res);

    } catch (error) {
        console.error('Error processing download request:', error);
        res.status(500).json({ error: 'Failed to process download request' });
    }
});

router.post('/downloadAll', jsonParser, async function (req, res) {
    const { files, nameType } = req.body;
    if (!files || files.length === 0) {
        return res.status(400).send('No files selected');
    }
    const archive = archiver('zip', {
        zlib: { level: 9 }
    });
    archive.on('warning', function (err) {
        if (err.code === 'ENOENT') {
            console.warn(err);
        } else {
            throw err;
        }
    });
    archive.on('error', function (err) {
        console.error('Error creating archive:', err);
        res.status(500).json({ error: 'Failed to create archive' });
    });
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename=' + (nameType === 'original' ? 'download.zip' : 'download_numbered.zip'));
    archive.pipe(res);

    try {
        const { default: fetch } = await import('node-fetch');

        // Use Promise.all to fetch all files concurrently
        await Promise.all(files.map(async (file) => {
            try {
                let newDerivativeUrl = await getSignedUrlFromDerivative(file.mainUrn, file.pdfUrn, req.session.internal);
                const fileResponse = await fetch(newDerivativeUrl.url, {
                    headers: {
                        'Cookie': Object.entries(newDerivativeUrl.cookies).map(([key, value]) => `${key}=${value}`).join('; ')
                    }
                });
                if (!fileResponse.ok) {
                    throw new Error(`HTTP error! status: ${fileResponse.status}`);
                }
                const fileContent = await fileResponse.arrayBuffer();
                const fileBuffer = Buffer.from(fileContent);

                let fileName;
                if (nameType === 'original') {
                    fileName = newDerivativeUrl.name;
                } else {
                    fileName = newDerivativeUrl.name.split(' ')[0] + '.pdf';
                }

                archive.append(fileBuffer, { name: fileName });
            } catch (error) {
                console.error('Error downloading file:', error);
            }
        }));
    } catch (error) {
        console.error('Error in downloadAll:', error);
        res.status(500).json({ error: 'Failed to process download request' });
        return;
    }

    archive.finalize();
});

async function getSignedUrlFromDerivative(urn, derivative, token) {
    const { default: fetch } = await import('node-fetch');

    let url = `https://developer.api.autodesk.com/modelderivative/v2/designdata/${urn.replaceAll('=', '')}/manifest/${derivative}/signedcookies?useCdn=true`;
    let options = {
        method: 'GET',
        headers: { Authorization: 'Bearer ' + token.access_token }
    };

    let resp = await fetch(url, options);
    let respJSON = await resp.json();

    let cookies = resp.headers.get('set-cookie');
    if (!cookies) {
        throw new Error('No cookies found in response');
    }

    let cookieArray = cookies.split(',').map(cookie => cookie.trim());
    let policy = cookieArray.find(cookie => cookie.startsWith('CloudFront-Policy=')).split(';')[0];
    let keypair = cookieArray.find(cookie => cookie.startsWith('CloudFront-Key-Pair-Id=')).split(';')[0];
    let signature = cookieArray.find(cookie => cookie.startsWith('CloudFront-Signature=')).split(';')[0];

    let data = {
        "name": derivative.split('/').slice(-1)[0],
        "url": respJSON.url,
        "cookies": {
            "CloudFront-Policy": policy.split('=')[1],
            "CloudFront-Key-Pair-Id": keypair.split('=')[1],
            "CloudFront-Signature": signature.split('=')[1]
        }
    };

    return data;
}

/////////////////////////////////////////////////////////////////
// Get the manifest of the given file. This will contain
// information about the various formats which are currently
// available for this file
/////////////////////////////////////////////////////////////////
router.get('/manifests/:urn', function (req, res) {
    const urn = urlSafeBase64Encode(decodeURIComponent(req.params.urn));
    var derivatives = new apsSDK.DerivativesApi();

    derivatives.getManifest(urn, {}, null, req.session.internal)
        .then(function (data) {
            console.log(data);
            res.json(data.body);
        })
        .catch(function (error) {
            console.error(error);
            res.status(500).json({ error: 'Failed to get manifest' });
        });
});

function urlSafeBase64Encode(str) {
    return Buffer.from(str).toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
}

router.delete('/manifests/:urn', function (req, res) {
    var derivatives = new apsSDK.DerivativesApi();
    try {
        derivatives.deleteManifest(req.params.urn, null, req.session.internal)
            .then(function (data) {
                res.json(data.body);
            })
            .catch(function (error) {
                res.status(error.statusCode).end(error.statusMessage);
            });

    } catch (err) {
        res.status(500).end(err.message);
    }
});

/////////////////////////////////////////////////////////////////
// Get the metadata of the given file. This will provide us with
// the guid of the avilable models in the file
/////////////////////////////////////////////////////////////////
router.get('/metadatas/:urn', function (req, res) {
    var derivatives = new apsSDK.DerivativesApi();

    derivatives.getMetadata(req.params.urn, {}, null, req.session.internal)
        .then(function (data) {
            res.json(data.body);
        })
        .catch(function (error) {
            res.status(error.statusCode).end(error.statusMessage);
        });
});

/////////////////////////////////////////////////////////////////
// Get the hierarchy information for the model with the given
// guid inside the file with the provided urn
/////////////////////////////////////////////////////////////////
router.get('/hierarchy', function (req, res) {
    var derivatives = new apsSDK.DerivativesApi();

    derivatives.getModelviewMetadata(req.query.urn, req.query.guid, {}, null, req.session.internal)
        .then(function (metaData) {
            if (metaData.body.data) {
                res.json(metaData.body);
            } else {
                res.json({ result: 'accepted' });
            }
        })
        .catch(function (error) {
            res.status(error.statusCode).end(error.statusMessage);
        });
});

/////////////////////////////////////////////////////////////////
// Get the properties for all the components inside the model
// with the given guid and file urn
/////////////////////////////////////////////////////////////////
router.get('/properties', function (req, res) {
    var derivatives = new apsSDK.DerivativesApi();

    derivatives.getModelviewProperties(req.query.urn, req.query.guid, {}, null, req.session.internal)
        .then(function (data) {
            res.json(data.body);
        })
        .catch(function (error) {
            res.status(error.statusCode).end(error.statusMessage);
        });
});

/////////////////////////////////////////////////////////////////
// Download the given derivative file, e.g. a STEP or other
// file format which are associated with the model file
/////////////////////////////////////////////////////////////////
router.get('/download', function (req, res) {
    var derivatives = new apsSDK.DerivativesApi();

    derivatives.getDerivativeManifest(req.query.urn, req.query.derUrn, {}, null, req.session.internal)
        .then(function (data) {
            var fileExt = req.query.fileName.split('.')[1];
            res.set('content-type', 'application/octet-stream');
            res.set('Content-Disposition', 'attachment; filename="' + req.query.fileName + '"');
            res.end(data.body);
        })
        .catch(function (error) {
            res.status(error.statusCode).end(error.statusMessage);
        });
});

/////////////////////////////////////////////////////////////////
// Send a translation request in order to get an SVF or other
// file format for our file
/////////////////////////////////////////////////////////////////
router.post('/export', jsonParser, function (req, res) {
    //env, token, urn, format, rootFileName, fileExtType, advanced
    var item = {
        "type": req.body.format
    };

    if (req.body.format === 'svf') {
        item.views = ['2d', '3d'];
    }

    if (req.body.advanced) {
        item.advanced = req.body.advanced;
    }

    let isComposite = (req.body.fileExtType && req.body.fileExtType === 'versions:autodesk.a360:CompositeDesign');

    var rootFilename = req.body.rootFileName
    if (rootFilename.endsWith(".zip")) {
        rootFilename = rootFilename.slice(0, -4)
        isComposite = true
    }

    var input = (isComposite) ? {
        "urn": req.body.urn,
        //"checkReferences": true
        "rootFilename": rootFilename,
        "compressedUrn": true
    } : {
        "urn": req.body.urn
    };


    //var input = {"urn": req.body.urn};
    var output = {
        "destination": {
            "region": "us"
        },
        "formats": [item]
    };

    var derivatives = new apsSDK.DerivativesApi();

    if (!derivatives)
        return;

    console.log("input", input);

    derivatives.translate({ "input": input, "output": output }, {}, null, req.session.internal)
        .then(function (data) {
            res.json(data.body);
        })
        .catch(function (error) {
            res.status(error.statusCode).end(error.statusMessage);
        });
});

/////////////////////////////////////////////////////////////////
// Return the router object that contains the endpoints
/////////////////////////////////////////////////////////////////
module.exports = router;