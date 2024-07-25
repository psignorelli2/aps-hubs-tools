$(document).ready(function () {
    var tokenData = {};
    var selectedNode = null;
    var selectedFiles = new Set();

    function showLoginButton() {
        $('#loginButton').show();
        $('#logoffButton, #convertButton').hide();
    }

    function showLogoffButton() {
        $('#loginButton').hide();
        $('#logoffButton').show();
    }

    function getToken() {
        return $.ajax({
            url: '/user/token',
            method: 'GET'
        });
    }

    function refreshToken() {
        getToken().then(function (data) {
            tokenData = data;
            if (tokenData.token) {
                showLogoffButton();
                initializeTree();
            } else {
                showLoginButton();
            }
        }).catch(function (error) {
            console.error('Error getting token:', error);
            showLoginButton();
        });
    }

    $('#loginButton').click(function () {
        $.ajax({
            url: '/user/authenticate',
            method: 'GET'
        }).then(function (url) {
            window.location = url;
        }).catch(function (error) {
            console.error('Error during authentication:', error);
        });
    });

    $('#logoffButton').click(function () {
        $.ajax({
            url: '/user/logoff',
            method: 'GET'
        }).then(function () {
            tokenData = {};
            $('#tree').jstree('destroy');
            showLoginButton();
        }).catch(function (error) {
            console.error('Error during logoff:', error);
        });
    });

    function showDownloadAllButton() {
        $('#downloadAllButton').show();
    }

    function hideDownloadAllButton() {
        $('#downloadAllButton').hide();
    }

    function initializeTree() {
        $('#tree').jstree({
            'core': {
                'data': function (node, callback) {
                    var href = node.id === '#' ? '#' : node.original.href;
                    $.ajax({
                        url: '/dm/treeNode',
                        method: 'GET',
                        data: { 'href': href },
                        headers: { 'Authorization': 'Bearer ' + tokenData.token }
                    }).then(function (data) {
                        data.forEach(function (node) {
                            if (node.type === 'versions') {
                                node.icon = false;
                                node.text = '<span class="node-content"><input type="checkbox" class="version-checkbox"><span class="version-name">' + node.text + '</span></span>';
                            } else if (node.type === 'viewable') {
                                node.icon = false;
                                node.text = '<span class="node-content"><input type="checkbox" class="file-checkbox" data-pdfurn="' + node.pdfUrn + '" data-mainurn="' + node.mainUrn + '"><span class="file-name">' + node.text + '</span></span>';
                            }
                        });
                        callback.call(this, data);
                    }).catch(function (error) {
                        console.error('Error fetching tree data:', error);
                        callback.call(this, []);
                    });
                }
            },
            "plugins": ["search", "wholerow"],
            "search": {
                "show_only_matches": false
            }
        }).on('select_node.jstree', function (e, data) {
            e.preventDefault();
            return false;
        }).on('click', '.version-checkbox', function (e) {
            e.stopPropagation();
            var $versionNode = $(this).closest('li');
            var checked = $(this).prop('checked');
            $versionNode.find('.file-checkbox').prop('checked', checked);
            updateSelectedFiles();
        }).on('click', '.file-checkbox', function (e) {
            e.stopPropagation();
            updateSelectedFiles();
        }).on('dblclick', '.file-name', function (e) {
            e.stopPropagation();
            var node = $(this).closest('li');
            var treeInstance = $('#tree').jstree(true);
            var nodeObj = treeInstance.get_node(node);
            if (nodeObj.original.type === 'viewable') {
                handleViewableClick(nodeObj);
            }
        }).on('open_node.jstree', function (e, data) {
            if (data.node.original.type === 'projects') {
                // When a project node is opened, open its first child (folder)
                var firstChild = data.node.children[0];
                if (firstChild) {
                    $('#tree').jstree('open_node', firstChild);
                }
            }
        }).on('ready.jstree', function () {
            var tree = $('#tree').jstree(true);
            // Open all top-level nodes
            tree.get_json('#', { flat: true })
                .filter(function (node) { return tree.get_parent(node) === '#'; })
                .forEach(function (node) { tree.open_node(node.id); });
        });
        var searchTimeout = false;
        $('#search-input').keyup(function () {
            if (searchTimeout) { clearTimeout(searchTimeout); }
            searchTimeout = setTimeout(function () {
                var v = $('#search-input').val();
                if (v.length > 0) {
                    searchTree(v);
                } else {
                    // If search is cleared, show all nodes
                    var tree = $('#tree').jstree(true);
                    tree.clear_search();
                    tree.show_all();
                }
            }, 250);
        });
    }

    function searchTree(query) {
        var tree = $('#tree').jstree(true);
        $('#search-loading').show();

        // Clear previous search
        tree.clear_search();

        // Array to store matching nodes
        var matches = [];

        // Custom search function
        tree.search(query, false, false, function (str, node) {
            // Only search in opened version nodes
            if (tree.is_open(node)) {
                var text = node.text.replace(/<[^>]*>/g, ""); // Remove HTML tags
                if (text.toLowerCase().indexOf(str.toLowerCase()) !== -1) {
                    matches.push(node.id);
                    return true;
                }
            }
            return false; // Don't include other node types in search results
        });

        // Reveal all matching nodes and their parents
        matches.forEach(function (nodeId) {
            tree.show_node(nodeId);
            tree._open_to(nodeId);
        });

        // Hide non-matching nodes
        tree.get_json('#', { flat: true }).forEach(function (node) {
            if (matches.indexOf(node.id) === -1 && node.type === 'versions') {
                tree.hide_node(node.id);
            }
        });

        $('#search-loading').hide();
    }

    function handleViewableClick(node) {
        console.log('Viewable clicked:', node);
        var pdfurn = node.original.pdfUrn;
        var mainUrn = node.original.mainUrn;

        // Trigger the download
        downloadFile(pdfurn, mainUrn);
    }

    function downloadFile(pdfurn, mainUrn) {
        // Create a temporary form to submit the download request
        var form = $('<form></form>')
            .attr('action', '/md/download')
            .attr('method', 'GET')
            .append($('<input>')
                .attr('type', 'hidden')
                .attr('name', 'pdfurn')
                .attr('value', pdfurn))
            .append($('<input>')
                .attr('type', 'hidden')
                .attr('name', 'mainUrn')
                .attr('value', mainUrn));

        // Append the form to the body, submit it, and remove it
        $('body').append(form);
        form.submit();
        form.remove();
    }

    function updateSelectedFiles() {
        selectedFiles.clear();
        $('.file-checkbox:checked').each(function () {
            selectedFiles.add({
                pdfUrn: $(this).data('pdfurn'),
                mainUrn: $(this).data('mainurn')
            });
        });

        // Update version checkboxes
        $('.version-checkbox').each(function () {
            var $versionNode = $(this).closest('li');
            var totalViewables = $versionNode.find('.file-checkbox').length;
            var checkedViewables = $versionNode.find('.file-checkbox:checked').length;
            $(this).prop('checked', totalViewables > 0 && totalViewables === checkedViewables);
        });

        if (selectedFiles.size > 0) {
            $('#downloadAllButton, #downloadAllShortButton').show();
        } else {
            $('#downloadAllButton, #downloadAllShortButton').hide();
        }
    }

    $('#downloadAllShortButton').click(function () {
        if (selectedFiles.size > 0) {
            downloadAllFiles('shortened');
        }
    });

    $('#downloadAllButton').click(function () {
        if (selectedFiles.size > 0) {
            downloadAllFiles('original');
        }
    });

    function downloadAllFiles(nameType) {
        $.ajax({
            url: '/md/downloadAll',
            method: 'POST',
            data: JSON.stringify({
                files: Array.from(selectedFiles),
                nameType: nameType
            }),
            contentType: 'application/json',
            headers: { 'Authorization': 'Bearer ' + tokenData.token },
            xhrFields: {
                responseType: 'blob'
            }
        }).then(function (response) {
            var blob = new Blob([response], { type: 'application/zip' });
            var link = document.createElement('a');
            link.href = window.URL.createObjectURL(blob);
            link.download = nameType === 'original' ? 'download.zip' : 'download_numbered.zip';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        }).catch(function (error) {
            console.error('Error downloading files:', error);
        });
    }

    refreshToken();
});