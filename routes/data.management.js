'use strict'; // http://www.w3schools.com/js/js_strict.asp

// web framework
var express = require('express');
var router = express.Router();
var bodyParser = require('body-parser');
var jsonParser = bodyParser.json();
var path = require('path');
var fs = require('fs');
var apsSDK = require('forge-apis');

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

router.get('/projects', function (req, res) {
    var hubs = new apsSDK.HubsApi();
    console.log(req.session.internal);
    hubs.getHubs({}, null, req.session.internal)
        .then(function (hubsData) {
            var projects = new apsSDK.ProjectsApi();
            var projectPromises = hubsData.body.data.map(hub =>
                projects.getHubProjects(hub.id, {}, null, req.session.internal)
            );

            Promise.all(projectPromises)
                .then(function (projectsData) {
                    var allProjects = projectsData.flatMap(p => p.body.data);
                    res.json(allProjects);
                })
                .catch(function (error) {
                    console.log(error);
                    res.status(500).json({ error: 'Failed to fetch projects' });
                });
        })
        .catch(function (error) {
            console.log(error);
            res.status(500).json({ error: 'Failed to fetch hubs' });
        });
});


/////////////////////////////////////////////////////////////////
// Provide information to the tree control on the client
// about the hubs, projects, folders and files we have on
// our A360 account
/////////////////////////////////////////////////////////////////
router.get('/treeNode', async function (req, res) {
    var href = decodeURIComponent(req.query.href);
    var projectId = req.query.projectId;
    if (href === '#') {
        try {
            // Get the hub ID
            var hubs = new apsSDK.HubsApi();
            let hubsData = await hubs.getHubs({}, null, req.session.internal);
            let hub = hubsData.body.data.find(hub => hub.attributes.name === "Jedson Engineering");
            if (!hub) {
                throw new Error("Jedson Engineering hub not found");
            }
            let hubId = hub.id;
            // Start from top folders
            var projects = new apsSDK.ProjectsApi();
            let topFolders = await projects.getProjectTopFolders(hubId, projectId, null, req.session.internal);
            res.json(makeTree(topFolders.body.data, true));
        } catch (error) {
            console.log(error);
            res.status(500).json({ error: 'Failed to fetch top folders: ' + error.message });
        }
    } else {
        var params = href.split('/');
        var resourceName = params[params.length - 2];
        var resourceId = params[params.length - 1];
        switch (resourceName) {
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
    const allResults = [];
    const pageSize = 100;
    const maxConcurrentRequests = 5; // Adjust based on API rate limits

    const fetchPage = async (pageNumber) => {
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
        return response.json();
    };

    const processResults = (data) => {
        allResults.push(...data.data);
        return data.links && data.links.next;
    };

    try {
        let hasMorePages = true;
        let currentPage = 0;

        while (hasMorePages) {
            const pagePromises = [];
            for (let i = 0; i < maxConcurrentRequests && hasMorePages; i++) {
                pagePromises.push(fetchPage(currentPage));
                currentPage++;
            }

            const results = await Promise.all(pagePromises);
            for (const result of results) {
                hasMorePages = processResults(result);
                if (!hasMorePages) break;
            }
        }
    } catch (error) {
        console.log("Error fetching DWG files:", error);
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