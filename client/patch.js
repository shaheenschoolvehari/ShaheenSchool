const fs = require('fs');
let c = fs.readFileSync('app/students/details/page.tsx', 'utf8');

c = c.replace(
    /<div className="d-flex justify-content-between align-items-center mb-4">\s*<div>\s*<h2 className="mb-1 fw-bold text-dark"/g,
    '<div className="d-flex justify-content-between align-items-center mb-4 p-4 rounded-4 shadow-sm" style={{ background: \'linear-gradient(135deg, var(--primary-dark) 0%, var(--primary-teal) 100%)\', color: \'white\' }}>\n                <div>\n                    <h2 className="mb-1 fw-bold text-white"'
);

c = c.replace(
    /<p className="text-muted mb-0">Manage and view student records<\/p>/g,
    '<p className="text-white-50 mb-0">Manage and view student records</p>'
);

c = c.replace(
    /className="d-flex align-items-center gap-2 text-primary"/g,
    'className="d-flex align-items-center gap-2" style={{ color: \'var(--primary-dark)\' }}'
);

c = c.replace(
    /<button className={`btn btn-sm \${showAdvancedFilters \? 'btn-primary' : 'btn-outline-primary'}`}[\s\S]*?onClick=\{\(\) => setShowAdvancedFilters\(!showAdvancedFilters\)}>\s*<i className="bi bi-sliders me-1"><\/i> Advanced\s*<\/button>/g,
    `<button className="btn btn-sm" style={{
                            backgroundColor: showAdvancedFilters ? 'var(--primary-teal)' : 'transparent',
                            color: showAdvancedFilters ? 'white' : 'var(--primary-teal)',
                            border: '1px solid var(--primary-teal)'
                        }}
                        onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}>
                        <i className="bi bi-sliders me-1"></i> Advanced  
                    </button>`
);

c = c.replace(
    /className="mb-0 fw-bold text-primary"/g,
    'className="mb-0 fw-bold" style={{ color: \'var(--primary-dark)\' }}'
);

c = c.replace(
    /className="badge bg-primary bg-opacity-10 text-primary ms-2"/g,
    'className="badge ms-2" style={{ backgroundColor: \'var(--primary-teal)\', color: \'white\' }}'
);

c = c.replace(
    /className=\{\`btn btn-sm \$\{showColPicker \? 'btn-primary' : 'btn-outline-primary'\}\`\}/g,
    `className="btn btn-sm"\n                                        style={{ backgroundColor: showColPicker ? 'var(--primary-teal)' : 'white', color: showColPicker ? 'white' : 'var(--primary-teal)', border: '1px solid var(--primary-teal)' }}`
);

c = c.replace(
    /className="text-uppercase small text-muted" style={{ backgroundColor: 'var(--primary-dark)', color: 'white' }}/g,
    'className="text-uppercase small" style={{ backgroundColor: \'var(--primary-dark)\', color: \'white\' }}'
);
fs.writeFileSync('app/students/details/page.tsx', c);
