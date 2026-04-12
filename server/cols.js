require('./db').query("SELECT column_name FROM information_schema.columns WHERE table_name='students'").then(res => console.log(res.rows.map(r=>r.column_name)));
