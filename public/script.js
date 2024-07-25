$(document).ready(function () {
    var tokenData = {};
    var selectedNode = null;

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
                        callback.call(this, data);
                    }).catch(function (error) {
                        console.error('Error fetching tree data:', error);
                        callback.call(this, []);
                    });
                }
            },
            "plugins": ["search"]
        }).on('select_node.jstree', function (e, data) {
            selectedNode = data.node;
            if (selectedNode.original.type === 'viewable') {
                // Handle click on 2D or 3D view
                handleViewableClick(selectedNode);
            }
        });
        var searchTimeout = false;
        $('#search-input').keyup(function () {
            if (searchTimeout) { clearTimeout(searchTimeout); }
            searchTimeout = setTimeout(function () {
                var v = $('#search-input').val();
                searchTree(v);
            }, 250);
        });
    }

    function searchTree(query) {
        var tree = $('#tree').jstree(true);
        $('#search-loading').show();

        // First, load all nodes
        tree.load_all(function () {
            // After all nodes are loaded, perform the search
            tree.search(query, false, true);

            // Open all nodes to show matches
            tree.open_all();

            $('#search-loading').hide();
        });
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

    refreshToken();
});