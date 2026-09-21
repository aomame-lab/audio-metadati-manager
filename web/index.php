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
            <div class="container-fluid px-3 px-lg-4">
                <a class="navbar-brand d-flex align-items-center gap-2" href="#">
                    <span class="brand-mark"><i class="bi bi-music-note-beamed"></i></span>
                    <span class="brand-text">Audio Metadati Manager</span>
                </a>

                <div class="d-flex align-items-center gap-2 order-lg-3">
                    <span class="badge rounded-pill badge-soft d-none d-sm-inline-flex align-items-center gap-1" id="trackCountBadge" title="Tracks loaded">
                        <i class="bi bi-collection"></i> <span id="trackCount">0</span> tracks
                    </span>
                    <button class="btn btn-icon" type="button" id="reloadBtn" data-bs-toggle="tooltip" data-bs-placement="bottom" aria-label="Reload library" title="Reload library">
                        <i class="bi bi-arrow-clockwise"></i>
                    </button>
                </div>

                <div class="order-lg-2 ms-lg-auto me-lg-3 w-100 mt-2 mt-lg-0" style="max-width: 640px;">
                    <div class="input-group input-group-path">
                        <span class="input-group-text"><i class="bi bi-folder2-open"></i></span>
                        <input type="text" id="libraryPath" class="form-control" placeholder="Music library path..." aria-label="Music library path" spellcheck="false">
                        <button class="btn btn-gold" type="button" id="scanBtn">
                            <i class="bi bi-search me-1"></i> SCAN
                        </button>
                    </div>
                </div>
            </div>
        </nav>
    </header>

    <main class="app-main container-fluid px-3 px-lg-4 py-3 py-lg-4">

        <!-- ======= TOOLBAR ======= -->
        <div class="d-flex flex-column flex-lg-row gap-2 gap-lg-3 align-items-lg-center mb-3">

            <div class="search-wrap flex-grow-1" style="max-width: 460px;">
                <div class="input-group">
                    <span class="input-group-text"><i class="bi bi-search"></i></span>
                    <input type="search" id="searchInput" class="form-control" placeholder="Search by title, artist, album, file, genre..." aria-label="Search tracks" autocomplete="off">
                    <button class="btn btn-clear hidden" type="button" id="clearSearchBtn" tabindex="-1" aria-label="Clear search" title="Clear search">
                        <i class="bi bi-x-lg"></i>
                    </button>
                </div>
            </div>

            <div class="d-flex flex-wrap align-items-center gap-2">
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

                <button class="btn btn-gold btn-sm" type="button" id="saveAllBtn" disabled>
                    <i class="bi bi-cloud-arrow-up me-1"></i>Save <span id="unsavedCount" class="badge bg-dark-subtle ms-1">0</span>
                </button>
            </div>
        </div>

        <!-- ======= CONTENT ======= -->
        <div class="row g-3 g-lg-4">

            <!-- Table column -->
            <div class="col-12 col-lg-8 col-xxl-9">
                <section class="panel" aria-label="Track list">
                    <div class="table-responsive">
                        <table class="table table-tracks align-middle mb-0" id="tracksTable">
                            <thead>
                                <tr>
                                    <th class="col-check" scope="col">
                                        <input type="checkbox" class="form-check-input" id="selectAllCheckbox" aria-label="Select all">
                                    </th>
                                    <th class="col-cover" scope="col"><span class="visually-hidden">Cover</span></th>
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
                                    <td colspan="11" class="text-center py-5">
                                        <div class="spinner-border spinner-border-sm me-2" role="status"><span class="visually-hidden">Loading...</span></div>
                                        Loading library...
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                    <div class="panel-footer d-flex justify-content-between align-items-center">
                        <span class="text-muted small" id="resultInfo">0 results</span>
                        <span class="text-muted small" id="libraryInfo"></span>
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
            <span><i class="bi bi-cpu"></i> Audio Metadati Manager &mdash; Python Core &middot; PHP API &middot; Bootstrap 5</span>
            <span id="apiStatus" class="badge rounded-pill badge-soft"><span class="status-dot"></span> connecting...</span>
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
                    <div class="form-check form-check-inline m-0">
                        <input type="checkbox" class="form-check-input" id="coverApplyAllCheckbox">
                        <label class="form-check-label small" for="coverApplyAllCheckbox">Apply to all tracks in this album/folder</label>
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
                            <div class="col-6">
                                <label class="form-label" for="bulkTrack">Track #</label>
                                <input type="number" class="form-control" id="bulkTrack" min="1">
                            </div>
                            <div class="col-6">
                                <label class="form-label" for="bulkTotal">Total tracks</label>
                                <input type="number" class="form-control" id="bulkTotal" min="1">
                            </div>
                            <div class="col-12">
                                <label class="form-label">Cover</label>
                                <button type="button" class="btn btn-outline-secondary btn-sm w-100 d-flex align-items-center justify-content-center gap-2" id="bulkCoverBtn">
                                    <i class="bi bi-images"></i> <span id="bulkCoverLabel">Choose cover...</span>
                                </button>
                                <div class="form-text">The cover will be applied to all selected tracks when you save.</div>
                            </div>
                        </div>
                    </form>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">Cancel</button>
                    <button type="button" class="btn btn-gold" id="bulkApplyBtn"><i class="bi bi-check2-circle me-1"></i>Apply</button>
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