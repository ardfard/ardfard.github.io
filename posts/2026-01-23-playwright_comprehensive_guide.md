---
title: "A Deep Dive into Playwright: Lifecycle, Fixtures, and Test Architecture"
date: "2026-01-23"
tags: "testing, playwright, typescript, automation, rust"
author: ardfard
---

# A Deep Dive into Playwright: Lifecycle, Fixtures, and Test Architecture

In building the [Kanjinomic](https://kanjinomic.com) Japanese vocabulary learning platform, I've implemented an End-to-End (E2E) testing suite using Playwright. This post documents the architectural decisions, the "magic" behind Playwright's fixture system, and the lifecycle of a test run.

## 1. The Architecture of a Playwright Project

Unlike a simple script folder, a scalable Playwright setup requires structure. Here is the anatomy of our `tests/e2e` directory:

```text
tests/e2e/
├── fixtures.ts          # The Engine Room: Custom fixture definitions
├── playwright.spec.ts   # The Specs: Actual test scenarios
└── README.md            # Documentation
```

### Configuration (`playwright.config.ts`)

The entry point is `playwright.config.ts`. It acts as the command center, telling Playwright:
1.  **Where to look**: `testDir: './tests/e2e'`
2.  **How to run**: `fullyParallel: true`
3.  **Environment**: `webServer` config to spin up the backend automatically.

## 2. Test Discovery: How Playwright "Finds" Code

When you run `bunx playwright test`, Playwright doesn't just run every file. It follows a specific discovery process:

1.  **Directory Scanning**: It looks inside `testDir` (configured as `./tests/e2e`).
2.  **Pattern Matching**: It looks for files ending in `.spec.ts`, `.test.ts`, etc.
    *   *Note*: This is why `fixtures.ts` is ignored—it doesn't match the pattern.
3.  **Parsing**: It parses matching files for `test()` and `test.describe()` blocks.

This separation allows us to keep helper logic (`fixtures.ts`) right next to the tests without Playwright trying to execute it as a test file.

### Visual Discovery Flow

```
┌─────────────────────────────────────────┐
│ 1. Read playwright.config.ts            │
│    testDir: './tests/e2e'               │
└─────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────┐
│ 2. Scan directory: tests/e2e/           │
│    ├── fixtures.ts                      │
│    ├── playwright.spec.ts  ← ✅ MATCH   │
│    └── README.md                        │
└─────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────┐
│ 3. Parse playwright.spec.ts             │
│    - Find test.describe() blocks        │
│    - Find test() calls                  │
│    - Count: 2 suites, ~10 tests         │
└─────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────┐
│ 4. Execute tests                        │
│    - Run each test() function           │
│    - Use fixtures from fixtures.ts      │
└─────────────────────────────────────────┘
```

## 3. The Power of Fixtures

The most confusing yet powerful part of Playwright is **Fixtures**. In traditional testing, you might have `beforeEach` and `afterEach` hooks cluttering your test files. Playwright replaces this with a dependency injection system.

### The `base.extend` Pattern

We extend the default `test` object.

```typescript
import { test as base } from '@playwright/test';

// We define a type for our custom world
type Fixtures = {
  dbPool: pg.Pool;
  testUser: TestUser;
  authenticatedPage: Page;
};

// We create a NEW test object with our fixtures baked in
export const test = base.extend<Fixtures>({
  // Fixture definitions go here...
});
```

This pattern means that any test importing our custom `test` object automatically has access to our custom environment, with full TypeScript support.

### Visual Flow of `base.extend()`

```
┌─────────────────────────────────────────┐
│ @playwright/test                        │
│ export const test = { ... }             │
│   - page fixture                        │
│   - context fixture                     │
│   - browser fixture                     │
│   - etc.                                │
└─────────────────────────────────────────┘
              │
              │ import { test as base }
              ▼
┌─────────────────────────────────────────┐
│ fixtures.ts                             │
│                                         │
│ base.extend<Fixtures>({                 │
│   dbPool: ...                           │
│   testUser: ...                         │
│   authenticatedPage: ...                │
│ })                                      │
│                                         │
│ Result: NEW test object with:           │
│   ✅ All base fixtures (page, etc.)     │
│   ✅ Your custom fixtures               │
└─────────────────────────────────────────┘
              │
              │ export const test
              ▼
┌─────────────────────────────────────────┐
│ playwright.spec.ts                      │
│ import { test } from './fixtures'       │
│                                         │
│ test('My test', async ({                │
│   page,              ← from base        │
│   testUser,          ← from extend      │
│   authenticatedPage  ← from extend      │
│ }) => { ... })                          │
└─────────────────────────────────────────┘
```

## 4. The Test Lifecycle: A Timeline

Understanding the order of operations is critical for debugging. Here is the lifecycle of a single test execution:

### Phase 1: Global Setup
Before any test file is touched, Playwright starts the `webServer` (our Rust backend). This happens once.

### Phase 2: Dependency Resolution (The Graph)
For a test requesting `({ authenticatedPage })`, Playwright builds a graph:

```
authenticatedPage depends on:
  ├── page (built-in fixture)
  ├── testUser (custom fixture)
  └── dbPool (custom fixture)

testUser depends on:
  └── dbPool (custom fixture)

testSentence depends on:
  └── dbPool (custom fixture)
```

**Resolution Order (Bottom-Up):**
1. `dbPool` (no dependencies)
2. `testUser` (needs `dbPool`)
3. `testSentence` (needs `dbPool`)
4. `page` (built-in, created automatically)
5. `authenticatedPage` (needs `page`, `testUser`, `dbPool`)

### Phase 3: Setup (Bottom-Up)
Fixtures are initialized in dependency order:
1.  **`dbPool`**: Connects to Postgres.
2.  **`testUser`**: Uses `dbPool` to insert a user via API/DB.
3.  **`page`**: Playwright launches the browser context.
4.  **`authenticatedPage`**: Logs the user in and navigates to the dashboard.

### Phase 4: Execution
The test function finally runs.

### Phase 5: Teardown (Top-Down / LIFO)
Once the test finishes (pass or fail), fixtures are torn down in reverse order:
1.  **`authenticatedPage`**: (Cleanup logic, if any).
2.  **`page`**: Browser context closes.
3.  **`testUser`**: User data is deleted from the DB.
4.  **`dbPool`**: Database connection closes.

### Complete Lifecycle Timeline

```
Time →
│
├─ [Global Setup]
│  └─ webServer: cargo run starts
│
├─ [Test 1 Starts]
│  ├─ dbPool setup
│  ├─ testUser setup
│  ├─ page setup
│  ├─ authenticatedPage setup
│  │
│  ├─ [TEST RUNS]
│  │  └─ Your test code executes
│  │
│  ├─ authenticatedPage teardown
│  ├─ page teardown
│  ├─ testUser teardown
│  └─ dbPool teardown
│
├─ [Test 2 Starts]
│  ├─ dbPool setup (NEW connection)
│  ├─ testUser setup (NEW user)
│  ├─ page setup (NEW page)
│  ├─ authenticatedPage setup
│  │
│  ├─ [TEST RUNS]
│  │
│  └─ [Teardown in reverse]
│
└─ [All Tests Complete]
   └─ webServer stops (if not reused)
```

### Detailed Fixture Execution Flow

For a test like `test('My test', async ({ authenticatedPage, testSentence }) => { ... })`:

```
┌─────────────────────────────────────────────────────────────┐
│ 1. Playwright resolves dependencies                         │
└─────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. Create dbPool fixture                                    │
│    dbPool: async ({}, use) => {                             │
│      const pool = new pg.Pool(...);  ← SETUP                │
│      await use(pool);          ← Test hasn't started yet!   │
│      await pool.end();         ← TEARDOWN (after test)      │
│    }                                                        │
└─────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. Create testUser fixture (needs dbPool)                   │
│    testUser: async ({ dbPool }, use) => {                   │
│      const user = await createTestUser(dbPool); ← SETUP     │
│      await use(user);          ← Test hasn't started yet!   │
│      await cleanupUser(...);   ← TEARDOWN (after test)      │
│    }                                                        │
└─────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. Create page fixture (built-in, automatic)                │
│    - Opens browser context                                  │
│    - Creates new page                                       │
└─────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────-┐
│ 5. Create authenticatedPage fixture                          │
│    authenticatedPage: async ({ page, testUser, dbPool }) => {│
│                                                              │
│      // SETUP PHASE (runs BEFORE test)                       │
│      const sentences = await createTestSentences(...);       │
│      await loginUser(page, testUser, baseUrl);               │
│                                                              │
│      await use(page);  ← TEST RUNS HERE                      │
│                                                              │
│      // TEARDOWN PHASE (runs AFTER test)                     │
│      for (const sentence of sentences) {                     │
│        await cleanupSentence(...);                           │
│      }                                                       │
│    }                                                         │
└─────────────────────────────────────────────────────────────-┘
         │
         ▼
┌─────────────────────────────────────────────────────────────┐
│ 6. Test executes                                            │
│    await authenticatedPage.goto(...);                       │
│    // ... test code ...                                     │
└─────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────┐
│ 7. Teardown in REVERSE order (LIFO - Last In First Out)     │
│    - authenticatedPage cleanup (delete sentences)           │
│    - page cleanup (close browser)                           │
│    - testUser cleanup (delete user)                         │
│    - dbPool cleanup (close connection)                      │
└─────────────────────────────────────────────────────────────┘
```

## 5. The Magic of `use()`

In a fixture, `use` is not just a return statement. It is a **callback that pauses execution**.

```typescript
testUser: async ({ dbPool }, use) => {
  // --- SETUP PHASE ---
  console.log('Creating user...');
  const user = await createTestUser(dbPool);

  // --- HANDOFF ---
  // This passes 'user' to the test and PAUSES this function
  await use(user);

  // --- TEARDOWN PHASE ---
  // This runs ONLY after the test completes
  console.log('Cleaning up user...');
  await cleanupUser(dbPool, user.id);
},
```

This "Setup -> Yield -> Teardown" pattern within a single function ensures that cleanup logic is co-located with setup logic, preventing data leaks and "flaky" tests.

### Visual Execution Timeline of `use()`

```typescript
// Your fixture definition
testUser: async ({ dbPool }, use) => {
  console.log('1. Setup: Creating user...');
  const user = await createTestUser(dbPool, baseUrl);
  console.log('2. User created:', user.email);
  
  console.log('3. About to call use()...');
  await use(user);  // ← MAGIC HAPPENS HERE
  console.log('4. use() returned, test is done!');
  
  console.log('5. Teardown: Cleaning up...');
  await cleanupUser(dbPool, user.id);
  console.log('6. Cleanup complete');
}

// Your test
test('My test', async ({ testUser }) => {
  console.log('TEST: Got user:', testUser.email);
  // ... test code ...
  console.log('TEST: Finished');
});
```

**Execution Order:**

```
1. Setup: Creating user...
2. User created: test_abc123@example.com
3. About to call use()...
   ┌─────────────────────────────────┐
   │ TEST: Got user: test_abc123...  │ ← Test runs here
   │ ... test code executes ...      │
   │ TEST: Finished                  │
   └─────────────────────────────────┘
4. use() returned, test is done!
5. Teardown: Cleaning up...
6. Cleanup complete
```

### Real Example: Complete Fixture Trace

When you write:

```typescript
test('Submitting answer shows feedback', async ({ authenticatedPage, testSentence }) => {
  await authenticatedPage.goto(`${BASE_URL}/learn`);
  // ... test code
});
```

**What actually happens:**

```typescript
// 1. dbPool fixture starts
const pool = new pg.Pool({ connectionString: DATABASE_URL });
// (pauses at await use(pool))

// 2. testUser fixture starts (needs dbPool)
const user = await createTestUser(dbPool, baseUrl);
// (pauses at await use(user))

// 3. testSentence fixture starts (needs dbPool)
const sentence = await createTestSentence(dbPool);
// (pauses at await use(sentence))

// 4. page fixture starts (built-in)
// Browser opens, page created
// (pauses at await use(page))

// 5. authenticatedPage fixture starts
const sentences = await createTestSentences(dbPool, 3, 'n5');
await loginUser(page, testUser, baseUrl);
// (pauses at await use(page))

// 6. NOW YOUR TEST RUNS
await authenticatedPage.goto(`${BASE_URL}/learn`);
// ... rest of test code ...

// 7. Test finishes, teardown starts (REVERSE ORDER)

// 7a. authenticatedPage teardown
for (const sentence of sentences) {
  await cleanupSentence(dbPool, sentence.id);
}

// 7b. page teardown (browser closes)

// 7c. testSentence teardown
await cleanupSentence(dbPool, sentence.id);

// 7d. testUser teardown
await cleanupUser(dbPool, user.id);

// 7e. dbPool teardown
await pool.end();
```

## 6. Integration vs. Regression

We use Playwright for both:

*   **Integration Testing**: Our tests verify the *integration* between the frontend (HTMX), the backend (Axum), and the database (Postgres). For example, creating a user verifies the entire stack works.
*   **Regression Testing**: By running these tests on every commit, we ensure that new changes haven't broken existing features. The `User can register` test is a regression test that guards the critical registration path.

### The Test Pyramid

```
        /\
       /E2E\          ← E2E tests (playwright.spec.ts)
      /------\
     /Integration\    ← Integration tests (integration_handlers.rs)
    /------------\
   /    Unit      \   ← Unit tests (in src/ modules)
  /----------------\
```

**Test Types:**
- **Unit Tests**: Fast, isolated (e.g., scoring function)
- **Integration Tests**: Medium speed, test interactions (e.g., API + DB)
- **E2E Tests**: Slower, full user journey (e.g., Playwright)

### How Tests Overlap

A test can be **both** integration and regression:

```rust
// From your state_consistency.rs
#[tokio::test]
async fn test_submission_creates_consistent_state() {
    // This is BOTH:
    // 1. Integration test: Tests handler + service + DB + transactions
    // 2. Regression test: Ensures state consistency doesn't break after changes
    
    // Test that submission updates:
    // - submissions table
    // - user_progress table  
    // - daily_stats table
    // All in one transaction (integration)
    // And this should never break (regression)
}
```

## 7. Common Folder Organization Patterns

### Pattern 1: Feature-Based (Recommended for Larger Projects)

```
tests/
├── e2e/
│   ├── auth/
│   │   ├── login.spec.ts
│   │   ├── register.spec.ts
│   │   └── fixtures.ts
│   ├── learning/
│   │   ├── sentence.spec.ts
│   │   ├── submission.spec.ts
│   │   └── fixtures.ts
│   ├── shared/
│   │   ├── fixtures.ts
│   │   └── helpers.ts
│   └── setup/
│       └── global-setup.ts
```

### Pattern 2: Type-Based 

```
tests/
├── e2e/
│   ├── fixtures.ts        # All fixtures
│   ├── playwright.spec.ts # All tests
│   └── helpers.ts         # Utility functions
```

### Pattern 3: Hybrid (Scales Well)

```
tests/
├── e2e/
│   ├── fixtures/
│   │   ├── auth.fixtures.ts
│   │   ├── learning.fixtures.ts
│   │   └── index.ts
│   ├── specs/
│   │   ├── auth.spec.ts
│   │   └── learning.spec.ts
│   ├── helpers/
│   │   ├── api.helpers.ts
│   │   └── db.helpers.ts
│   └── setup/
│       └── global-setup.ts
```

## 8. Key Takeaways Summary

### Understanding Test Discovery

Playwright discovers tests by:
1. Reading `testDir` from config (`./tests/e2e`)
2. Finding files matching `*.spec.*` or `*.test.*` patterns
3. Parsing those files for `test()` and `test.describe()` calls
4. Executing the discovered tests

In our case:
- Config: `testDir: './tests/e2e'`
- Test file: `playwright.spec.ts` (matches pattern)
- Tests found: All `test()` calls inside `test.describe()` blocks
- Helper file: `fixtures.ts` (ignored, but imported by tests)

### Understanding Fixture Lifecycle

1. **`await use()` pauses the fixture** and runs the test
2. **Dependencies are resolved bottom-up** (dependencies first)
3. **Teardown runs in reverse order** (LIFO)
4. **Each test gets fresh fixture instances** (test-scoped)
5. **Global setup (webServer) runs once** before all tests

### Understanding `base.extend()`

- `base.extend()` creates a new test object that combines Playwright's built-in fixtures with your custom fixtures
- It's executed when the test file imports `test` from `fixtures.ts`
- It enables using custom fixtures like `testUser`, `dbPool`, and `authenticatedPage` in your tests
- The `<Fixtures>` type provides TypeScript support for your custom fixtures

Without `base.extend()`, you'd only have Playwright's built-in fixtures. With it, you get both built-in and custom fixtures in one `test` object.

## Conclusion

By leveraging Playwright's fixture system, we've created a test suite that is:
1.  **Isolated**: Every test gets a fresh user and database state.
2.  **Clean**: No global setup/teardown mess in spec files.
3.  **Typed**: TypeScript knows exactly what data is available in each test.
4.  **Maintainable**: Fixtures are reusable and composable.
5.  **Reliable**: Automatic cleanup prevents test pollution.

This architecture provides the confidence needed to iterate quickly on the Kanjinomic platform without fear of breaking critical user flows. 

## Resources

- [Playwright Fixtures Documentation](https://playwright.dev/docs/test-fixtures)
- [Playwright Test Configuration](https://playwright.dev/docs/test-configuration)
- [Custom Fixtures Guide](https://playwright.dev/docs/test-fixtures#creating-a-fixture)
- [Test Discovery Patterns](https://playwright.dev/docs/test-intro#writing-tests)
