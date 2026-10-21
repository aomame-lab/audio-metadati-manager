<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Audio Metadati Manager</title>

    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css" rel="stylesheet">
    <link href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.css" rel="stylesheet">
    <link href="assets/css/style.css" rel="stylesheet">
</head>
<body>

    <!-- ======= TOP BAR ======= -->
    <header class="app-header sticky-top">
        <nav class="navbar navbar-expand-lg" aria-label="Main navigation">
            <div class="container-fluid px-3 px-lg-4 header-row">
                <a class="navbar-brand d-flex align-items-center gap-2" href="#">
                    <span class="brand-mark"><i> <img src="audio-metadati-manager-logo.svg"></i></span>
                    <span class="brand-text">Audio Metadati Manager</span>
                </a>

                <div class="d-flex align-items-center gap-2 order-lg-3" id="headerActions">
                    <span class="badge rounded-pill badge-soft library-badge" id="trackCountBadge" title="Library summary">
                        <i class="bi bi-collection" aria-hidden="true"></i>
                        <span id="libraryStats" class="library-stats-inline" aria-live="polite">—</span>
                    </span>
                    <button class="btn btn-icon" type="button" id="reloadBtn" data-bs-toggle="tooltip" data-bs-placement="bottom" aria-label="Reload library" title="Reload library">
                        <i class="bi bi-arrow-clockwise"></i>
                    </button>
                </div>

                <!-- Mini player: same <audio> element and same playerState as the
                     play buttons of the tracks and of the albums, no second player. -->
                <div class="order-lg-2 ms-lg-auto me-lg-3 mini-player" id="miniPlayer" role="group" aria-label="Mini player">
                    <span class="mini-eq" id="miniEq" aria-hidden="true">
                        <span></span><span></span><span></span><span></span>
                    </span>
                    <span class="mini-meta" aria-live="polite">
                        <span class="mini-title" id="miniTitle" title="Nessuna traccia in riproduzione">Nessuna traccia in riproduzione</span>
                        <span class="mini-artist" id="miniArtist"></span>
                    </span>
                    <span class="mini-controls">
                        <button class="mini-btn" type="button" id="miniPrevBtn"
                                aria-label="Traccia precedente" title="Traccia precedente" disabled>
                            <i class="bi bi-skip-backward"></i>
                        </button>
                        <button class="mini-btn mini-btn-play" type="button" id="miniPlayPauseBtn"
                                aria-label="Riproduci" title="Riproduci" disabled>
                            <i class="bi bi-play-fill"></i>
                        </button>
                        <button class="mini-btn" type="button" id="miniNextBtn"
                                aria-label="Traccia successiva" title="Traccia successiva" disabled>
                            <i class="bi bi-skip-forward"></i>
                        </button>
                    </span>
                </div>
            </div>
        </nav>
    </header>

    <main class="app-main container-fluid px-3 px-lg-4 py-3 py-lg-4">

        
        <!-- ======= TOOLBAR ======= -->
        <div class="app-toolbar d-flex flex-column flex-lg-row gap-2 gap-lg-3 align-items-lg-center mb-3">

            <!-- Search -->
            <div class="search-wrap flex-grow-1 flex-shrink-0" style="max-width: 460px; min-width: 280px;">
                <div class="input-group flex-nowrap">
                    <span class="input-group-text">
                        <i class="bi bi-search"></i>
                    </span>

                    <input
                        type="search"
                        id="searchInput"
                        class="form-control"
                        placeholder="Search artist, album or track..."
                        aria-label="Search artist, album or track"
                        autocomplete="off"
                    >

                    <button
                        class="btn btn-clear hidden"
                        type="button"
                        id="clearSearchBtn"
                        tabindex="-1"
                        aria-label="Clear search"
                        title="Clear search"
                    >
                        <i class="bi bi-x-lg"></i>
                    </button>
                </div>
            </div>


            <div class="btn-group btn-group-sm" role="group" aria-label="Library view">
                <button class="btn btn-outline-secondary" type="button" id="viewArtistsBtn" aria-pressed="true" title="Browse by artist and album">
                    <i class="bi bi-diagram-3"></i><span class="d-none d-md-inline ms-1">Artists</span>
                </button>
                <button class="btn btn-outline-secondary" type="button" id="viewTracksBtn" aria-pressed="false" title="Flat list of all tracks">
                    <i class="bi bi-list-ul"></i><span class="d-none d-md-inline ms-1">Tracks</span>
                </button>
            </div>

            <div class="d-flex flex-wrap align-items-center gap-2">
                <button class="btn btn-outline-secondary btn-sm" type="button" id="foldersBtn"
                        data-bs-toggle="tooltip" data-bs-placement="bottom"
                        title="Browse and register the music folders available in the container">
                    <i class="bi bi-folder-plus me-1"></i>Cartelle musicali
                    <span class="badge rounded-pill badge-soft ms-1 d-none" id="foldersCountBadge" aria-hidden="true">0</span>
                </button>

                <select id="filterFormat" class="form-select form-select-sm w-auto" aria-label="Format filter">
                    <option value="all">All formats</option>
                    <option value=".mp3">MP3</option>
                    <option value=".flac">FLAC</option>
                    <option value=".m4a">M4A</option>
                </select>

                <select id="filterStatus" class="form-select form-select-sm w-auto" aria-label="Status filter">
                    <option value="all">All tracks</option>
                    <option value="unsaved">Unsaved only</option>
                    <option value="saved">Saved only</option>
                </select>

                <div class="btn-group btn-group-sm" role="group" aria-label="Track selection">
                    <button class="btn btn-outline-secondary" type="button" id="selectAllBtn" data-bs-toggle="tooltip" title="Select all visible tracks">
                        <i class="bi bi-check-all"></i><span class="d-none d-md-inline ms-1">Select</span>
                    </button>
                    <button class="btn btn-outline-secondary" type="button" id="deselectAllBtn" data-bs-toggle="tooltip" title="Deselect all">
                        <i class="bi bi-x-circle"></i><span class="d-none d-md-inline ms-1">Deselect</span>
                    </button>
                </div>

                <button class="btn btn-outline-secondary btn-sm" type="button" id="bulkBtn">
                    <i class="bi bi-pencil-square me-1"></i>Edit Selected
                </button>
            </div>
        </div>

        <!-- ======= CONTENT ======= -->
        <div class="row g-3 g-lg-4">

            <!-- Library column -->
            <div class="col-12 col-lg-8 col-xxl-9">

                <!-- Hierarchy: Artist -> Album -> Track -->
                <section class="panel library-panel" id="artistViewPanel" aria-label="Library by artist, album and track">
                    <div class="tree-head" aria-hidden="true">
                        <span class="tree-head-cell">Artist / Album</span>
                        <span class="tree-head-cell tree-head-num">Tracks</span>
                    </div>
                    <div id="artistTree" class="artist-tree" role="tree" aria-label="Library hierarchy"></div>
                    <div class="panel-footer d-flex justify-content-between align-items-center">
                        <span class="text-muted small" id="treeResultInfo">0 results</span>
                        <span class="text-muted small" id="libraryInfo"></span>
                    </div>
                </section>

                <!-- Flat list -->
                <section class="panel" id="trackViewPanel" aria-label="Track list" hidden>
                    <div class="table-responsive">
                        <table class="table table-tracks align-middle mb-0" id="tracksTable">
                            <thead>
                                <tr>
                                    <th class="col-check" scope="col">
                                        <input type="checkbox" class="form-check-input" id="selectAllCheckbox" aria-label="Select all">
                                    </th>
                                    <th class="col-cover" scope="col"><span class="visually-hidden">Cover</span></th>
                                    <th class="col-play" scope="col"><span class="visually-hidden">Play</span></th>
                                    <th class="col-num" scope="col">#</th>
                                    <th scope="col">Title</th>
                                    <th scope="col">Artist</th>
                                    <th class="d-none d-xl-table-cell" scope="col">Album</th>
                                    <th class="d-none d-md-table-cell" scope="col">Genre</th>
                                    <th class="d-none d-lg-table-cell" scope="col">Year</th>
                                    <th class="d-none d-lg-table-cell col-dur" scope="col">Duration</th>
                                    <th scope="col">File</th>
                                    <th class="col-status" scope="col">Status</th>
                                </tr>
                            </thead>
                            <tbody id="tracksBody">
                                <tr id="initialLoadingRow">
                                    <td colspan="12" class="text-center py-5">
                                        <div class="spinner-border spinner-border-sm me-2" role="status"><span class="visually-hidden">Loading...</span></div>
                                        Loading library...
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                    <div class="panel-footer d-flex justify-content-between align-items-center">
                        <span class="text-muted small" id="resultInfo">0 results</span>
                    </div>
                </section>

            </div>

            <!-- Details column -->
            <div class="col-12 col-lg-4 col-xxl-3">
                <section class="panel details-panel d-none d-lg-block" id="detailsPanelSection" aria-label="Track details">
                    <div class="panel-header">
                        <h2 class="panel-title"><i class="bi bi-sliders"></i> Track details</h2>
                    </div>
                    <div class="panel-body" id="detailsPanel">
                        <div class="empty-state">
                            <i class="bi bi-music-note-beamed"></i>
                            <p>Select a track to edit it</p>
                        </div>
                    </div>
                </section>
            </div>
        </div>

        <footer class="app-footer">
    <div class="footer-left">
        <a href="https://github.com/aomame-lab/audio-metadati-manager"
           target="_blank"
           rel="noopener noreferrer"
           aria-label="GitHub repository"
           title="GitHub repository"
           class="footer-logo">
            <img src="aomame-lab-1.svg" alt="aomame-lab">
        </a>
    </div>

    <div class="footer-center">
        <span> V.1.2.0</span>
    </div>

    <div class="footer-right">
        <span id="apiStatus" class="badge rounded-pill badge-soft">
            <span class="status-dot"></span>
            connecting...
        </span>
    </div>
</footer>
</main>

    <!-- ======= DETAILS OFF-CANVAS (mobile) ======= -->
    <div class="offcanvas offcanvas-end" tabindex="-1" id="detailsOffcanvas" aria-labelledby="detailsOffcanvasLabel">
        <div class="offcanvas-header">
            <h5 class="offcanvas-title" id="detailsOffcanvasLabel"><i class="bi bi-sliders"></i> Track details</h5>
            <button type="button" class="btn-close" data-bs-dismiss="offcanvas" aria-label="Close"></button>
        </div>
        <div class="offcanvas-body" id="offcanvasDetailsBody">
            <div class="empty-state">
                <i class="bi bi-music-note-beamed"></i>
                <p>Select a track to edit it</p>
            </div>
        </div>
    </div>

    <!-- ======= COVER MODAL ======= -->
    <div class="modal fade" id="coverModal" tabindex="-1" aria-labelledby="coverModalLabel" aria-hidden="true">
        <div class="modal-dialog modal-lg modal-dialog-centered modal-dialog-scrollable">
            <div class="modal-content">
                <div class="modal-header">
                    <h5 class="modal-title" id="coverModalLabel"><i class="bi bi-images"></i> Select Cover</h5>
                    <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                </div>
                <div class="modal-body" id="coverModalBody">
                    <div class="text-center py-4"><div class="spinner-border spinner-border-sm" role="status"><span class="visually-hidden">Loading...</span></div></div>
                </div>
                <div class="modal-footer justify-content-between align-items-center flex-wrap gap-2">
                    <div>
                        <button type="button" class="btn btn-outline-secondary" id="coverUploadBtn">
                            <i class="bi bi-upload me-1"></i>Upload Cover
                        </button>
                        <input type="file" class="d-none" id="coverUploadInput" accept="image/jpeg,.jpg,.jpeg">
                    </div>
                    <div>
                        <button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">Cancel</button>
                        <button type="button" class="btn btn-gold" id="coverApplyBtn">Apply</button>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <!-- ======= BULK EDIT MODAL ======= -->
    <div class="modal fade" id="bulkModal" tabindex="-1" aria-labelledby="bulkModalLabel" aria-hidden="true">
        <div class="modal-dialog modal-dialog-centered">
            <div class="modal-content">
                <div class="modal-header">
                    <h5 class="modal-title" id="bulkModalLabel"><i class="bi bi-pencil-square"></i> Bulk Edit</h5>
                    <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                </div>
                <div class="modal-body">
                    <p class="text-muted small mb-3">
                        Set the fields to apply to <strong id="bulkCount">0</strong> selected tracks.
                        Leave a field empty to keep its current value.
                    </p>
                    <form id="bulkForm" novalidate>
                        <div class="row g-3">
                            <div class="col-12">
                                <label class="form-label" for="bulkAlbum">Album</label>
                                <input type="text" class="form-control" id="bulkAlbum" autocomplete="off">
                            </div>
                            <div class="col-12">
                                <label class="form-label" for="bulkArtist">Artist</label>
                                <input type="text" class="form-control" id="bulkArtist" autocomplete="off">
                            </div>
                            <div class="col-12">
                                <label class="form-label" for="bulkGenre">Genre</label>
                                <input type="text" class="form-control" id="bulkGenre" autocomplete="off">
                            </div>
                            <div class="col-6">
                                <label class="form-label" for="bulkYear">Year</label>
                                <input type="number" class="form-control" id="bulkYear" min="1000" max="2100">
                            </div>
                            <div class="col-12">
                                <label class="form-label" for="bulkCoverPickBtn">Cover</label>
                                <div class="bulk-cover">
                                    <div class="bulk-cover-preview" id="bulkCoverPreviewBox">
                                        <div class="cover-placeholder" id="bulkCoverPlaceholder">
                                            <i class="bi bi-image"></i><span>NO COVER</span>
                                        </div>
                                        <img id="bulkCoverPreview" alt="Selected cover preview" hidden>
                                    </div>
                                    <div class="bulk-cover-side">
                                        <input type="file" id="bulkCoverInput" accept="image/jpeg,.jpg,.jpeg" hidden>
                                        <div class="d-flex flex-wrap gap-2">
                                            <button type="button" class="btn btn-outline-secondary btn-sm" id="bulkCoverPickBtn">
                                                <i class="bi bi-folder2-open me-1"></i><span id="bulkCoverPickLabel">Choose image...</span>
                                            </button>
                                            <button type="button" class="btn btn-outline-secondary btn-sm d-none" id="bulkCoverClearBtn">
                                                <i class="bi bi-x-lg me-1"></i>Clear
                                            </button>
                                        </div>
                                        <div class="form-text text-truncate" id="bulkCoverLabel">No file selected.</div>
                                    </div>
                                </div>
                                <div class="form-text">JPEG only. The cover is embedded into all selected tracks when you save.</div>
                            </div>
                        </div>
                    </form>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-outline-secondary" id="bulkCancelBtn" data-bs-dismiss="modal">Annulla</button>
                    <button type="button" class="btn btn-gold" id="bulkApplyBtn"><i class="bi bi-check2-circle me-1"></i>Salva modifiche</button>
                </div>
            </div>
        </div>
    </div>

    <!-- ======= MUSIC FOLDERS MODAL ======= -->
    <div class="modal fade" id="foldersModal" tabindex="-1" aria-labelledby="foldersModalLabel" aria-hidden="true">
        <div class="modal-dialog modal-lg modal-dialog-centered modal-dialog-scrollable">
            <div class="modal-content">
                <div class="modal-header">
                    <h5 class="modal-title" id="foldersModalLabel"><i class="bi bi-folder-plus"></i> Cartelle musicali</h5>
                    <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                </div>

                <div class="modal-body">
                    <div class="row g-3">

                        <!-- Registered folders -->
                        <div class="col-12 col-lg-5">
                            <div class="folder-panel">
                                <div class="folder-panel-head">
                                    <span class="panel-title"><i class="bi bi-collection"></i> Registered folders</span>
                                </div>
                                <div class="folder-panel-body" id="foldersList" aria-live="polite">
                                    <div class="text-center py-4"><div class="spinner-border spinner-border-sm" role="status"><span class="visually-hidden">Loading...</span></div></div>
                                </div>
                            </div>
                        </div>

                        <!-- Explorer -->
                        <div class="col-12 col-lg-7">
                            <div class="folder-panel">
                                <div class="folder-panel-head">
                                    <span class="panel-title"><i class="bi bi-folder2-open"></i> Add a folder</span>
                                </div>
                                <div class="folder-panel-body">
                                    <div class="mb-2">
                                        <label class="form-label" for="folderRootSelect">Mounted root</label>
                                        <select id="folderRootSelect" class="form-select form-select-sm" aria-label="Mounted root"></select>
                                    </div>

                                    <div class="d-flex align-items-center gap-2 mb-2">
                                        <button class="btn btn-outline-secondary btn-sm flex-shrink-0" type="button" id="folderUpBtn"
                                                aria-label="Go to the parent folder" title="Parent folder" disabled>
                                            <i class="bi bi-arrow-90deg-up"></i>
                                        </button>
                                        <code class="folder-path flex-grow-1" id="folderCurrentPath" aria-live="polite">—</code>
                                    </div>

                                    <div class="folder-browser" id="folderBrowser" aria-live="polite">
                                        <div class="text-center py-4"><div class="spinner-border spinner-border-sm" role="status"><span class="visually-hidden">Loading...</span></div></div>
                                    </div>

                                    <div class="mt-3">
                                        <label class="form-label" for="folderLabelInput">Label (optional)</label>
                                        <input type="text" id="folderLabelInput" class="form-control form-control-sm"
                                               placeholder="e.g. Rock" maxlength="120" autocomplete="off">
                                    </div>
                                    <p class="form-text mb-0" id="folderBrowserHint">Select a folder in the list, or the current one, then add it.</p>
                                </div>
                            </div>
                        </div>

                    </div>
                </div>

                <div class="modal-footer justify-content-between align-items-center flex-wrap gap-2">
                    <span class="text-muted small" id="foldersStatus" aria-live="polite"></span>
                    <div class="d-flex gap-2">
                        <button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">Close</button>
                        <button type="button" class="btn btn-outline-gold" id="folderAddBtn">
                            <i class="bi bi-plus-lg me-1"></i>Add this folder
                        </button>
                        <button type="button" class="btn btn-gold" id="foldersScanBtn">
                            <i class="bi bi-arrow-clockwise me-1"></i>Scan folders
                        </button>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <!-- ======= CONFIRM MODAL ======= -->
    <div class="modal fade" id="confirmModal" tabindex="-1" aria-hidden="true">
        <div class="modal-dialog modal-dialog-centered modal-sm">
            <div class="modal-content">
                <div class="modal-body text-center pt-4">
                    <div class="confirm-icon mb-3"><i class="bi bi-exclamation-triangle"></i></div>
                    <p id="confirmText" class="mb-0">Are you sure?</p>
                </div>
                <div class="modal-footer justify-content-center border-0 pt-0">
                    <button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">Cancel</button>
                    <button type="button" class="btn btn-gold" id="confirmOkBtn">Confirm</button>
                </div>
            </div>
        </div>
    </div>

    <!-- ======= TOASTS ======= -->
    <div class="toast-container position-fixed top-0 end-0 p-3" id="toastContainer" aria-live="polite" aria-atomic="true"></div>

    <!-- ======= LOADING OVERLAY ======= -->
    <div class="loading-overlay d-none" id="loadingOverlay">
        <div class="loading-card">
            <div class="spinner-border spinner-gold mb-3" role="status"><span class="visually-hidden">Loading...</span></div>
            <div class="loading-text" id="loadingText">Working...</div>
            <div class="loading-sub" id="loadingSub"></div>
        </div>
    </div>

    <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/js/bootstrap.bundle.min.js"></script>
    <script src="assets/js/app.js"></script>
</body>
</html>