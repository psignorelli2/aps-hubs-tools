'use strict'; // http://www.w3schools.com/js/js_strict.asp

// web framework
var express = require('express');
var router = express.Router();
var bodyParser = require('body-parser');
var jsonParser = bodyParser.json();
var path = require('path');
var fs = require('fs');
var apsSDK = require('forge-apis');
const { shallowCopy } = require('ejs/lib/utils');

const fields = [
    "id",
    "type",
    "links.self.href",
    "relationships.storage.data.id",
    "relationships.derivatives.data.id",
    "attributes.displayName",
    "attributes.name",
    "attributes.extension.type",
    "attributes.fileType",
    "attributes.versionNumber"
].join(',');


/////////////////////////////////////////////////////////////////
// Provide information to the tree control on the client
// about the hubs, projects, folders and files we have on
// our A360 account
/////////////////////////////////////////////////////////////////
router.get('/treeNode', async function (req, res) {
    var href = decodeURIComponent(req.query.href);
    if (href === '#') {
        // # stands for ROOT
        var hubs = new apsSDK.HubsApi();

        try {
            hubs.getHubs({}, null, req.session.internal)
                .then(function (data) {
                    res.json(makeTree(data.body.data, true));
                })
                .catch(function (error) {
                    console.log(error);
                });
        } catch (ex) {
            console.log(ex);
        }
    } else {
        var params = href.split('/');
        var resourceName = params[params.length - 2];
        var resourceId = params[params.length - 1];
        switch (resourceName) {
            case 'hubs':
                // if the caller is a hub, then show projects
                var projects = new apsSDK.ProjectsApi();

                projects.getHubProjects(resourceId/*hub_id*/, {}, null, req.session.internal)
                    .then(function (projects) {
                        res.json(makeTree(projects.body.data, true));
                    })
                    .catch(function (error) {
                        console.log(error);
                    });
                break;
            case 'projects':
                // if the caller is a project, then show folders
                var hubId = params[params.length - 3];

                // Work with top folders instead
                var projects = new apsSDK.ProjectsApi();
                projects.getProjectTopFolders(hubId, resourceId, null, req.session.internal)
                    .then(function (topFolders) {
                        res.json(makeTree(topFolders.body.data, true));
                    })
                    .catch(function (error) {
                        console.log(error);
                    });

                break;
            case 'folders':
                // if the caller is a folder, then show contents
                let projectId = params[params.length - 3];
                try {
                    let [rvtContents, dwgContents] = await Promise.all([
                        searchFolders(projectId, resourceId, req.session.internal),
                        searchFoldersDWG(projectId, resourceId, req.session.internal)
                    ]);
                    let allContents = rvtContents.concat(dwgContents);
                    res.json(makeTree(allContents, true));
                } catch (error) {
                    console.error('Error in search:', error);
                    res.status(500).json({ error: 'Failed to fetch folder contents' });
                }
                break;

            case 'versions':
                let projectIdd = params[params.length - 3];
                let versions = new apsSDK.VersionsApi();
                try {
                    let versionResponse = await versions.getVersion2(projectIdd, resourceId, {}, null, req.session.internal);
                    let version = versionResponse.body.data.id;

                    const manifestUrl = `http://localhost:3000/md/manifests/${encodeURIComponent(version)}`;

                    try {
                        const { default: fetch } = await import('node-fetch');

                        const manifestResponse = await fetch(manifestUrl, {
                            headers: {
                                Cookie: req.headers.cookie // Pass the session cookie
                            }
                        });

                        if (!manifestResponse.ok) {
                            throw new Error(`HTTP error! status: ${manifestResponse.status}`);
                        }

                        const manifestData = await manifestResponse.json();

                        const manifestTree = makeManifestTree(manifestData);
                        res.json(manifestTree);
                    } catch (manifestError) {
                        console.error('Error fetching manifest:', manifestError);
                        res.status(500).json({ error: 'Failed to fetch manifest' });
                    }
                } catch (error) {
                    console.log('Error getting version:', error);
                    res.status(500).json({ error: 'Failed to get version' });
                }
                break;
        }
    }
});

function makeManifestTree(manifestData) {
    if (!manifestData || !manifestData.derivatives || !manifestData.derivatives[0].children) {
        return [];
    }

    var treeList = [];
    manifestData.derivatives[0].children.forEach(function (item) {
        if (item.role === '2d') {
            let pdf = item.children.find(child => child.role === 'pdf-page');
            var treeItem = {
                text: `${item.name} (${item.role.toUpperCase()})`,
                viewableID: item.viewableID,
                type: 'viewable',
                role: item.role,
                pdfUrn: pdf.urn,
                mainUrn: manifestData.urn,
                fileName: item.name // Add this line
            };
            treeList.push(treeItem);
        }
    });

    return treeList;
}

async function searchFolders(project, resourceId, token) {
    try {
        const url = new URL(
            `https://developer.api.autodesk.com/data/v1/projects/${project}/folders/${resourceId}/search`
        );
        const headers = {
            Authorization: `Bearer ${token.access_token}`,
        };
        const params = {
            "filter[fileType]": "rvt",
            "filter[attributes.extension.type]": "versions:autodesk.bim360:C4RModel",
            "fields": fields
        };
        Object.keys(params).forEach((key) =>
            url.searchParams.append(key, params[key])
        );
        const response = await fetch(url, {
            method: "GET",
            headers: headers,
        });
        if (!response.ok) {
            throw new Error();
        }
        const data = await response.json();
        return data.data;
    } catch (error) {
        console.log(error);
    }
}

async function searchFoldersDWG(project, resourceId, token) {
    let allResults = [];
    let pageNumber = 0;
    const pageSize = 100;
    let hasMoreResults = true;

    while (hasMoreResults) {
        try {
            const url = new URL(
                `https://developer.api.autodesk.com/data/v1/projects/${project}/folders/${resourceId}/search`
            );
            const headers = {
                Authorization: `Bearer ${token.access_token}`,
            };
            const params = {
                "filter[fileType]": "dwg",
                "page[number]": pageNumber,
                "page[limit]": pageSize,
                "fields": fields
            };
            Object.keys(params).forEach((key) =>
                url.searchParams.append(key, params[key])
            );
            const response = await fetch(url, {
                method: "GET",
                headers: headers,
            });
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const data = await response.json();
            allResults = allResults.concat(data.data);

            // Check if there are more pages
            hasMoreResults = data.links && data.links.next;
            pageNumber++;
        } catch (error) {
            console.log("Error fetching DWG files:", error);
            hasMoreResults = false;
        }
    }

    return allResults;
}


/////////////////////////////////////////////////////////////////
// Collects the information that we need to pass to the
// file tree object on the client
/////////////////////////////////////////////////////////////////
function makeTree(items, canHaveChildren, data) {
    if (!items) return '';
    var treeList = [];
    items.forEach(function (item, index) {
        var fileExt = (item.attributes ? item.attributes.fileType : null);
        if (!fileExt && item.attributes && item.attributes.name) {
            var fileNameParts = item.attributes.name.split('.');
            if (fileNameParts.length > 1) {
                fileExt = fileNameParts[fileNameParts.length - 1];
            }
        }

        var versionText = "";
        if (item.type === "versions") {
            versionText = " (v" + item.attributes.versionNumber + ")";
        }

        var treeItem = {
            href: item.links.self.href,
            wipid: item.id,
            storage: (item.relationships != null && item.relationships.storage != null ? item.relationships.storage.data.id : null),
            data: (item.relationships != null && item.relationships.derivatives != null ? item.relationships.derivatives.data.id : null),
            text: (item.attributes.displayName == null ? item.attributes.name : item.attributes.displayName) + versionText,
            fileName: (item.attributes ? item.attributes.name : null),
            rootFileName: (item.attributes ? item.attributes.name : null),
            fileExtType: (item.attributes && item.attributes.extension ? item.attributes.extension.type : null),
            fileType: fileExt,
            type: item.type,
            children: canHaveChildren
        };
        treeList.push(treeItem);
    });

    return treeList;
}

/////////////////////////////////////////////////////////////////
// Return the router object that contains the endpoints
/////////////////////////////////////////////////////////////////
module.exports = router;