---
title: "PostgreSQL from Zero"
---

PostgreSQL is a powerful, open-source relational database system known for its stability, extensibility, and standards compliance. While most users install PostgreSQL via package managers or container images, building it from source unlocks a deeper level of control and understanding. Whether you're a developer looking to experiment with PostgreSQL internals, apply patches, or enable non-default features, compiling from source gives you complete flexibility.

This article walks you through the entire process—from fetching the PostgreSQL source code and configuring the build to initializing a database, managing roles, and customizing the server. Along the way, we'll explore how to run and patch your own PostgreSQL instance, giving you the skills to hack on one of the most robust database systems available today.

## 1. Getting the PostgreSQL Source

To begin working with PostgreSQL from the ground up, the first step is obtaining the source code. Whether you're building it for development, testing a patch, or learning internals, having the latest source is essential.

### a. Cloning the Official Repository

PostgreSQL's source code is hosted on [GitHub](https://github.com/postgres/postgres) and its own Git server. You can clone it using:

```bash
git clone git://git.postgresql.org/git/postgresql.git
cd postgres
```

You might want to check out a specific stable release branch (e.g., `REL_16_STABLE`) or tag (e.g., `REL_16_2`):

```bash
git checkout REL_16_STABLE
```

This will allow you to build from a tested and maintained version of the codebase.

### b. Downloading a Release Tarball (Optional)

If you prefer not to use Git or want a specific version in archive format:

```bash
wget https://ftp.postgresql.org/pub/source/v16.2/postgresql-16.2.tar.gz
tar -xzf postgresql-16.2.tar.gz
cd postgresql-16.2
```

Tarballs are a good option for production builds or offline installations.

---

## 2. Configuring PostgreSQL

Before compiling, PostgreSQL needs to be configured based on your environment and desired features. This step detects available libraries and prepares the build system accordingly.

### a. Installing Prerequisites

Install development tools and required libraries:

**On Ubuntu/Debian:**

```bash
sudo apt update
sudo apt install build-essential libreadline-dev zlib1g-dev flex bison
```

**On macOS (with Homebrew):**

```bash
brew install readline zlib bison
```

Use `which bison` to make sure it's the Homebrew version (e.g., `/opt/homebrew/bin/bison`). Older versions shipped with macOS may cause issues.

### b. Running `configure`

To keep the source tree clean, create a separate build directory:

```bash
mkdir build
cd build
../configure --prefix=$HOME/pgsql --enable-debug --enable-cassert
```

Common configure flags:

- `--prefix`: sets installation directory
- `--enable-debug`: includes debug symbols
- `--enable-cassert`: enables runtime assertions for development

You can customize further using:

- `--with-python`: enable PL/Python language
- `--with-perl`: enable PL/Perl
- `--with-tcl`: enable PL/Tcl
- `--with-openssl`: enable SSL support
- `--with-ldap`: enable LDAP authentication
- `--with-llvm`: enable Just-In-Time (JIT) compilation

To explore more options:

```bash
../configure --help
```

Then build and install:

```bash
make -j$(nproc)
make install
```

---

## 3. Initializing the Database

Now that PostgreSQL is compiled and installed, it's time to create the initial database cluster.

### a. Set Environment Variables

Ensure PostgreSQL binaries are in your path:

```bash
export PATH=$HOME/pgsql/bin:$PATH
```

Create a directory for your data:

```bash
mkdir -p $HOME/pgdata
```

### b. User Context and Permissions

PostgreSQL is designed to run under a dedicated system user (commonly `postgres`). This helps isolate permissions and avoid accidental damage.

```bash
sudo useradd -m postgres
sudo chown -R postgres:postgres $HOME/pgdata
```

Alternatively, you can run everything under your own username (e.g., `ardfard`), but ensure it has proper permissions.

### c. Default Role Behavior

When you initialize the database using `initdb`, it creates a default superuser role named after the OS user who ran the command. If you're `ardfard`, then `ardfard` will be the superuser.

To create a different superuser (e.g., `postgres`):

```bash
initdb -D $HOME/pgdata --username=postgres
```

This avoids confusion when connecting later using tools like `psql`.

### d. Running `initdb`

Initialize the database cluster:

```bash
initdb -D $HOME/pgdata
```

You can customize locale, encoding, auth method:

```bash
initdb -D $HOME/pgdata --locale=en_US.UTF-8 --encoding=UTF8 --auth=md5
```

### e. Starting the PostgreSQL Server

```bash
pg_ctl -D $HOME/pgdata -l logfile start
```

The `pg_ctl` utility handles server management: start, stop, restart, and status checks.

### f. Connecting to PostgreSQL

By default, PostgreSQL attempts to connect using the same OS username for both role and database. If these don’t exist, you’ll see:

```
psql: error: FATAL: role "ardfard" does not exist
```

Instead, connect to the default database and create what you need:

```bash
psql -d postgres

-- Inside psql:
CREATE ROLE ardfard WITH LOGIN SUPERUSER;
CREATE DATABASE ardfard OWNER ardfard;
```

---

## 4. Starting and Stopping the Server

Understanding server lifecycle management is critical for both development and production.

### a. Starting the Server

```bash
pg_ctl -D $HOME/pgdata -l logfile start
```

Ensure the log file is writable. You can also use `-o` to pass additional options.

### b. Stopping the Server

```bash
pg_ctl -D $HOME/pgdata stop -m fast
```

Modes:

- `smart`: Waits for clients to disconnect (default)
- `fast`: Immediate disconnect but graceful shutdown
- `immediate`: Abrupt shutdown without cleanup (not recommended unless debugging)

### c. Restarting the Server

```bash
pg_ctl -D $HOME/pgdata restart
```

This applies config changes without needing full shutdown cycles.

### d. Checking Server Status

```bash
pg_ctl -D $HOME/pgdata status
```

Shows PID and whether the server is running.

---

## 5. Creating Users and Databases

Once your server is operational, you'll want to create specific roles and databases for applications or development workflows.

### a. Creating a Role

Log in to the main cluster:

```bash
psql -U ardfard -d postgres
```

Create a user:

```sql
CREATE ROLE devuser WITH LOGIN PASSWORD 'securepassword';
ALTER ROLE devuser WITH CREATEDB CREATEROLE;
```

You can grant `SUPERUSER` as needed:

```sql
ALTER ROLE devuser WITH SUPERUSER;
```

### b. Creating a Database

```sql
CREATE DATABASE devdb OWNER devuser;
```

Connect with:

```bash
psql -U devuser -d devdb
```

You can also use flags like `ENCODING`, `LC_COLLATE`, and `TEMPLATE`.

### c. Listing Resources

```sql
\du  -- roles
\l   -- databases
```

---

## 6. Running Custom Patches or Modifying Source

PostgreSQL is renowned for its extensibility. You can patch internals, add features, or test fixes.

### a. Applying a Patch

Use standard patch tools:

```bash
patch -p1 < /path/to/fix.diff
```

Or with Git:

```bash
git apply /path/to/patch.diff
```

After patching:

```bash
./configure --prefix=$HOME/pgsql --enable-debug
make -j$(nproc)
make install
```

### b. Exploring Source Internals

PostgreSQL is modular. Explore areas like:

- `src/backend/`: main logic (executor, parser, planner)
- `src/include/`: shared headers
- `src/bin/`: command-line tools
- `src/interfaces/`: libraries like libpq
- `src/common/`: utilities used by multiple binaries

Want to modify expression evaluation? See `src/backend/executor/`.

### c. Adding New Functions

To add a built-in function:

1. Edit or add a `.c` file under `src/backend/utils/adt/`
2. Define it in `pg_proc.dat`
3. Run:

```bash
make -C src/backend/utils/adt
```

Then:

```sql
CREATE FUNCTION my_func(...) RETURNS ... AS 'MODULE_PATHNAME', 'my_func' LANGUAGE C;
```

## Closing

Building PostgreSQL from source opens up a world of possibilities for developers, researchers, and system architects who want to gain a deeper understanding of one of the world’s most powerful relational databases. Whether you're experimenting with core internals, testing patches, or tailoring the database to specific needs, compiling from source gives you complete control over the PostgreSQL runtime and feature set.

PostgreSQL is not just a database, it's also a robust platform built for innovation. Whether you're extending it for your application's needs or contributing back to the community, compiling from source is a great first step in mastering its architecture.

Happy hacking!