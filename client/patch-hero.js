const fs = require('fs');
let content = fs.readFileSync('app/students/profile/[id]/page.tsx', 'utf8');
const search = `      return (
          <div className="container-fluid p-0 bg-light min-vh-100">
              {/* HERO SECTION */}`;

const replace = `      return (
          <div className="container-fluid p-0 bg-light min-vh-100">
              {changePwdModalOpen && (
                  <div className="modal d-block" style={{ backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 1050 }}>
                      <div className="modal-dialog modal-dialog-centered">
                          <div className="modal-content border-0 shadow">
                              <div className="modal-header bg-light border-0">
                                  <h5 className="modal-title fs-6"><i className="bi bi-shield-lock me-2 text-primary"></i>Change Password</h5>
                                  <button type="button" className="btn-close" onClick={() => setChangePwdModalOpen(false)}></button>
                              </div>
                              <div className="modal-body">
                                  <div className="mb-3">
                                      <label className="form-label small text-muted">New Password (Min 6 characters)</label>
                                      <input type="text" className="form-control" value={newAdminPwd} onChange={(e) => setNewAdminPwd(e.target.value)} placeholder="Enter new password" autoFocus />
                                  </div>
                              </div>
                              <div className="modal-footer border-0">
                                  <button type="button" className="btn btn-light btn-sm" onClick={() => setChangePwdModalOpen(false)}>Cancel</button>
                                  <button type="button" className="btn btn-primary btn-sm" onClick={handleChangePassword} disabled={isChangingPwd}>
                                      {isChangingPwd ? 'Updating...' : 'Update Password'}
                                  </button>
                              </div>
                          </div>
                      </div>
                  </div>
              )}
              {/* HERO SECTION */}`;

content = content.replace(search, replace);
content = content.replace(search.replace(/\n/g, '\r\n'), replace); // handle CRLF
fs.writeFileSync('app/students/profile/[id]/page.tsx', content);
console.log("Patched hero");
