$(document).ready(function () {
    var tokenData = {};
    var selectedFiles = new Set();
    var selectedProjectId = null;

    function showLoginButton() {
        $('#loginButton').show();
        $('#logoffButton, #convertButton, #projectSelect').hide();
    }

    function showLogoffButton() {
        $('#loginButton').hide();
        $('#logoffButton, #projectSelect').show();
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
                loadProjects();
            } else {
                showLoginButton();
            }
        }).catch(function (error) {
            console.error('Error getting token:', error);
            showLoginButton();
        });
    }

    function loadProjects() {
        $.ajax({
            url: '/dm/projects',
            method: 'GET',
            headers: { 'Authorization': 'Bearer ' + tokenData.token }
        }).then(function (projects) {
            var $select = $('#projectSelect').empty().show();
            $select.append($('<option></option>').text('Select a project'));
            projects.forEach(function (project) {
                $select.append($('<option></option>')
                    .attr('value', project.id)
                    .text(project.attributes.name));
            });
        }).catch(function (error) {
            console.error('Error loading projects:', error);
        });
    }

    $('#projectSelect').change(function () {
        selectedProjectId = $(this).val();
        if (selectedProjectId) {
            if ($('#tree').jstree(true)) {
                $('#tree').jstree('destroy');
            }
            initializeTree();
        }
    });

    $('#tree').on('click', '.version-checkbox, .file-checkbox', function (e) {
        e.stopPropagation();
        var $checkbox = $(this);
        var $node = $checkbox.closest('.jstree-node');
        var treeInstance = $('#tree').jstree(true);
        var nodeId = $node.attr('id');
        var nodeObj = treeInstance.get_node(nodeId);

        if ($checkbox.hasClass('version-checkbox')) {
            handleVersionCheckbox($checkbox, nodeObj, treeInstance);
        } else {
            updateSelectedFiles();
        }
    });

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

    function initializeTree() {
        $('#tree').jstree({
            'core': {
                'data': function (node, callback) {
                    var href = node.id === '#' ? '#' : node.original.href;
                    var nodeType = node.original ? node.original.type : null;

                    // Show loading indicator for the node being expanded
                    if (node.id !== '#') {
                        $('#' + node.id + '_anchor').addClass('jstree-loading');
                    }

                    $.ajax({
                        url: '/dm/treeNode',
                        method: 'GET',
                        data: {
                            'href': href,
                            'projectId': selectedProjectId
                        },
                        headers: { 'Authorization': 'Bearer ' + tokenData.token }
                    }).then(function (data) {
                        data.forEach(function (node) {
                            if (node.type === 'versions' || node.type === 'viewable') {
                                node.icon = false;
                                node.text = '<span class="node-content"><input type="checkbox" class="' +
                                    (node.type === 'versions' ? 'version-checkbox' : 'file-checkbox') +
                                    '" ' + (node.type === 'viewable' ? 'data-pdfurn="' + node.pdfUrn + '" data-mainurn="' + node.mainUrn + '"' : '') +
                                    '><span class="' + (node.type === 'versions' ? 'version-name' : 'file-name') + '">' +
                                    node.text + '</span></span>';
                            }
                            if (node.type === 'versions') {
                                node.children = true; // This tells jsTree that this node has children
                            }
                        });
                        callback.call(this, data);
                    }).catch(function (error) {
                        console.error('Error fetching tree data:', error);
                        callback.call(this, []);
                    }).always(function () {
                        // Remove loading indicator
                        if (node.id !== '#') {
                            $('#' + node.id + '_anchor').removeClass('jstree-loading');
                        }
                    });
                }
            },
            "plugins": ["search", "wholerow"],
            "search": {
                "show_only_matches": false
            }
        }).on('ready.jstree', function () {
            hideLoading();
        }).on('click', '.version-checkbox, .file-checkbox', function (e) {
            e.stopPropagation();
            var $checkbox = $(this);
            var $node = $checkbox.closest('li');
            var treeInstance = $('#tree').jstree(true);
            var nodeObj = treeInstance.get_node($node);

            if ($checkbox.hasClass('version-checkbox')) {
                handleVersionCheckbox($checkbox, nodeObj, treeInstance);
            } else {
                updateSelectedFiles();
            }
        }).on('dblclick', '.file-name', function (e) {
            e.stopPropagation();
            var node = $(this).closest('li');
            var treeInstance = $('#tree').jstree(true);
            var nodeObj = treeInstance.get_node(node);
            if (nodeObj.original.type === 'viewable') {
                handleViewableClick(nodeObj);
            }
        });

        setupSearch();
    }

    function handleVersionCheckbox($checkbox, nodeObj, treeInstance) {
        var isChecked = $checkbox.prop('checked');

        if (!treeInstance.is_open(nodeObj)) {
            treeInstance.open_node(nodeObj, function () {
                toggleChildCheckboxes(nodeObj, isChecked, treeInstance);
            });
        } else {
            toggleChildCheckboxes(nodeObj, isChecked, treeInstance);
        }
    }

    function toggleChildCheckboxes(nodeObj, isChecked, treeInstance) {
        treeInstance.get_node(nodeObj).children.forEach(function (childId) {
            var $childNode = $('#' + childId);
            var $childCheckbox = $childNode.find('.file-checkbox');
            $childCheckbox.prop('checked', isChecked);
        });
        updateSelectedFiles();
    }

    function setupSearch() {
        var searchTimeout = false;
        $('#search-input').keyup(function () {
            if (searchTimeout) { clearTimeout(searchTimeout); }
            searchTimeout = setTimeout(function () {
                var v = $('#search-input').val();
                if (v.length > 0) {
                    searchTree(v);
                } else {
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
        tree.search(query, false, true);
        $('#search-loading').hide();

        setTimeout(function () {
            var firstMatch = $('.jstree-search').first();
            if (firstMatch.length) {
                scrollToNode(firstMatch);
            }
        }, 100);
    }

    function scrollToNode($node) {
        var container = $('#tree');
        var scrollTo = $node.offset().top - container.offset().top + container.scrollTop();

        container.animate({
            scrollTop: scrollTo - (container.height() / 2)
        }, 500);

        $node.addClass('highlight-search');
        setTimeout(function () {
            $node.removeClass('highlight-search');
        }, 2000);
    }

    function handleViewableClick(node) {
        downloadFile(node.original.pdfUrn, node.original.mainUrn);
    }

    function downloadFile(pdfurn, mainUrn) {
        var form = $('<form></form>')
            .attr('action', '/md/download')
            .attr('method', 'GET')
            .append($('<input>').attr('type', 'hidden').attr('name', 'pdfurn').attr('value', pdfurn))
            .append($('<input>').attr('type', 'hidden').attr('name', 'mainUrn').attr('value', mainUrn));
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

        $('.version-checkbox').each(function () {
            var $versionNode = $(this).closest('.jstree-node');
            var totalViewables = $versionNode.find('.file-checkbox').length;
            var checkedViewables = $versionNode.find('.file-checkbox:checked').length;
            $(this).prop('checked', totalViewables > 0 && totalViewables === checkedViewables);
        });

        $('#downloadAllButton, #downloadAllShortButton').toggle(selectedFiles.size > 0);
    }

    $('#downloadAllShortButton, #downloadAllButton').click(function () {
        if (selectedFiles.size > 0) {
            downloadAllFiles($(this).attr('id') === 'downloadAllShortButton' ? 'shortened' : 'original');
        }
    });

    function downloadAllFiles(nameType) {
        showLoading();
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
        }).always(function () {
            hideLoading();
        });
    }

    function showLoading(message = 'Loading...') {
        $('#loadingMessage').text(message);
        $('#loadingOverlay').show();
    }

    function hideLoading() {
        $('#loadingOverlay').hide();
    }

    refreshToken();
});