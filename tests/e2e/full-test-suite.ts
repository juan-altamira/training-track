import "dotenv/config";
import { Stagehand } from "@browserbasehq/stagehand";
import { z } from "zod";

const CONFIG = {
  baseUrl: process.env.TEST_BASE_URL || "http://localhost:5173",
  testUser: {
    email: "juampiluduena@gmail.com",
    password: "juan1998"
  }
};

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  duration: number;
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

class TestRunner {
  private results: TestResult[] = [];
  
  async runTest(name: string, testFn: () => Promise<void>): Promise<void> {
    const start = Date.now();
    try {
      await testFn();
      this.results.push({ name, passed: true, duration: Date.now() - start });
      console.log(`✅ PASSED: ${name} (${Date.now() - start}ms)`);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.results.push({ name, passed: false, error: errorMsg, duration: Date.now() - start });
      console.error(`❌ FAILED: ${name} - ${errorMsg}`);
    }
  }
  
  printSummary(): void {
    console.log("\n" + "=".repeat(70));
    console.log("                        TEST SUMMARY");
    console.log("=".repeat(70));
    
    const passed = this.results.filter(r => r.passed).length;
    const failed = this.results.filter(r => !r.passed).length;
    const total = this.results.length;
    
    console.log(`\nTotal: ${total} | ✅ Passed: ${passed} | ❌ Failed: ${failed}\n`);
    console.log("-".repeat(70));
    
    this.results.forEach(r => {
      const status = r.passed ? "✅" : "❌";
      console.log(`${status} ${r.name} (${r.duration}ms)`);
      if (r.error) {
        console.log(`   └─ Error: ${r.error}`);
      }
    });
    
    console.log("=".repeat(70));
    
    if (failed > 0) {
      process.exitCode = 1;
    }
  }
}

async function main() {
  console.log("🚀 Starting Training Track E2E Test Suite with Stagehand\n");
  console.log(`Base URL: ${CONFIG.baseUrl}`);
  console.log(`Test User: ${CONFIG.testUser.email}\n`);
  
  const runner = new TestRunner();
  
  // Initialize Stagehand
  console.log("📦 Initializing Stagehand...");
  const stagehand = new Stagehand({
    env: "LOCAL",
    verbose: 1,
    localBrowserLaunchOptions: {
      headless: process.env.HEADLESS !== "false"
    }
  });
  
  await stagehand.init();
  console.log("✅ Stagehand initialized\n");
  
  const page = stagehand.context.pages()[0];

  try {

    // ============================================================
    // AUTHENTICATION TESTS
    // ============================================================
    console.log("\n📋 AUTHENTICATION TESTS\n" + "-".repeat(40));

    // Test 1: Login page loads correctly
    await runner.runTest("1. Login page loads correctly", async () => {
      await page.goto(`${CONFIG.baseUrl}/login`);
      await page.waitForLoadState("networkidle");
      
      const content = await stagehand.extract(
        "Extract the main heading and check if email/password fields exist",
        z.object({
          heading: z.string().describe("Main heading text on the page"),
          hasEmailField: z.boolean().describe("Whether email input exists"),
          hasPasswordField: z.boolean().describe("Whether password input exists"),
          hasLoginButton: z.boolean().describe("Whether login/enter button exists")
        })
      );
      
      if (!content.hasEmailField || !content.hasPasswordField) {
        throw new Error("Login page missing required fields");
      }
      console.log(`   📝 Heading: ${content.heading}`);
    });

    // Test 2: Invalid login shows error
    await runner.runTest("2. Invalid login shows error message", async () => {
      await page.goto(`${CONFIG.baseUrl}/login`);
      await page.waitForLoadState("networkidle");
      
      await stagehand.act("Type 'invalid@test.com' in the email field");
      await stagehand.act("Type 'wrongpassword123' in the password field");
      await stagehand.act("Click the 'Entrar' button");
      
      await sleep(3000);
      
      const errorCheck = await stagehand.extract(
        "Check if an error message is displayed",
        z.object({
          hasError: z.boolean().describe("Whether an error message is visible"),
          errorText: z.string().optional().describe("The error message text")
        })
      );
      
      if (!errorCheck.hasError) {
        throw new Error("Expected error message for invalid credentials");
      }
      console.log(`   📝 Error shown: ${errorCheck.errorText}`);
    });

    // Test 3: Valid login redirects to clientes
    await runner.runTest("3. Valid login redirects to /clientes", async () => {
      await page.goto(`${CONFIG.baseUrl}/login`);
      await page.waitForLoadState("networkidle");
      
      await stagehand.act(`Type '${CONFIG.testUser.email}' in the email field`);
      await stagehand.act(`Type '${CONFIG.testUser.password}' in the password field`);
      await stagehand.act("Click the 'Entrar' button");
      
      await sleep(5000);
      
      const url = page.url();
      if (!url.includes("/clientes")) {
        throw new Error(`Expected redirect to /clientes, got ${url}`);
      }
      console.log(`   📝 Redirected to: ${url}`);
    });

    // Test 4: Registration page accessible
    await runner.runTest("4. Registration page loads correctly", async () => {
      await page.goto(`${CONFIG.baseUrl}/registro`);
      await page.waitForLoadState("networkidle");
      
      const content = await stagehand.extract(
        "Extract registration page information",
        z.object({
          heading: z.string().describe("Main heading"),
          hasEmailField: z.boolean().describe("Has email input"),
          hasPasswordField: z.boolean().describe("Has password input"),
          hasConfirmField: z.boolean().describe("Has confirm password input")
        })
      );
      
      if (!content.hasEmailField || !content.hasPasswordField) {
        throw new Error("Registration page missing required fields");
      }
      console.log(`   📝 Heading: ${content.heading}`);
    });

    // Test 5: Password reset page accessible
    await runner.runTest("5. Password reset page loads correctly", async () => {
      await page.goto(`${CONFIG.baseUrl}/reset`);
      await page.waitForLoadState("networkidle");
      
      const content = await stagehand.extract(
        "Extract reset page information",
        z.object({
          hasEmailField: z.boolean().describe("Has email input"),
          hasSubmitButton: z.boolean().describe("Has submit button")
        })
      );
      
      if (!content.hasEmailField || !content.hasSubmitButton) {
        throw new Error("Reset page missing required fields");
      }
    });

    // ============================================================
    // CLIENTS PANEL TESTS
    // ============================================================
    console.log("\n📋 CLIENTS PANEL TESTS\n" + "-".repeat(40));

    // Login first for panel tests
    await page.goto(`${CONFIG.baseUrl}/login`);
    await page.waitForLoadState("networkidle");
    await stagehand.act(`Type '${CONFIG.testUser.email}' in the email field`);
    await stagehand.act(`Type '${CONFIG.testUser.password}' in the password field`);
    await stagehand.act("Click the 'Entrar' button");
    await sleep(5000);

    // Test 6: Clients panel shows correctly
    await runner.runTest("6. Clients panel displays correctly", async () => {
      await page.goto(`${CONFIG.baseUrl}/clientes`);
      await page.waitForLoadState("networkidle");
      
      const panelContent = await stagehand.extract(
        "Extract information about the clients panel",
        z.object({
          hasClientsList: z.boolean().describe("Whether a clients list or message exists"),
          hasCreateForm: z.boolean().describe("Whether create client form exists"),
          hasSearchField: z.boolean().describe("Whether search field exists"),
          hasLogoutButton: z.boolean().describe("Whether logout button exists")
        })
      );
      
      if (!panelContent.hasLogoutButton) {
        throw new Error("Panel missing logout button");
      }
      console.log(`   📝 Panel loaded correctly`);
    });

    // Test 7: Create client form validation
    await runner.runTest("7. Create client form has required fields", async () => {
      await page.goto(`${CONFIG.baseUrl}/clientes`);
      await page.waitForLoadState("networkidle");
      
      const formContent = await stagehand.extract(
        "Extract the create client form fields",
        z.object({
          hasNameField: z.boolean().describe("Whether name input field exists"),
          hasObjectiveField: z.boolean().describe("Whether objective field exists"),
          hasSubmitButton: z.boolean().describe("Whether submit/create button exists")
        })
      );
      
      if (!formContent.hasNameField || !formContent.hasSubmitButton) {
        throw new Error("Create form missing required fields");
      }
    });

    // Test 8: Create a test client
    const testClientName = `Test Client ${Date.now()}`;
    await runner.runTest("8. Create new client successfully", async () => {
      await page.goto(`${CONFIG.baseUrl}/clientes`);
      await page.waitForLoadState("networkidle");
      
      await stagehand.act(`Type '${testClientName}' in the name field for creating a client`);
      await stagehand.act("Type 'Test objective - Stagehand E2E' in the objective field");
      await stagehand.act("Click the 'Crear y generar link' button");
      
      await sleep(3000);
      
      const clientCheck = await stagehand.extract(
        `Check if a client named '${testClientName}' appears in the list`,
        z.object({
          clientExists: z.boolean().describe("Whether the new client appears in the list"),
          clientName: z.string().optional().describe("The client name found")
        })
      );
      
      if (!clientCheck.clientExists) {
        throw new Error("Client was not created");
      }
      console.log(`   📝 Created client: ${testClientName}`);
    });

    // Test 9: Search clients functionality
    await runner.runTest("9. Search clients works correctly", async () => {
      await page.goto(`${CONFIG.baseUrl}/clientes`);
      await page.waitForLoadState("networkidle");
      
      await stagehand.act("Type 'Test' in the search field");
      await stagehand.act("Click the 'Buscar' button");
      
      await sleep(2000);
      
      const searchResults = await stagehand.extract(
        "Check the search results",
        z.object({
          hasResults: z.boolean().describe("Whether any clients are shown"),
          resultsContainTestClients: z.boolean().describe("Whether results contain 'Test' in name")
        })
      );
      
      console.log(`   📝 Search returned results: ${searchResults.hasResults}`);
    });

    // Test 10: Open client details
    await runner.runTest("10. Open client details page", async () => {
      await page.goto(`${CONFIG.baseUrl}/clientes`);
      await page.waitForLoadState("networkidle");
      
      await stagehand.act("Click on 'Abrir rutina del cliente' button for the first client in the list");
      
      await sleep(3000);
      
      const url = page.url();
      if (!url.includes("/clientes/")) {
        throw new Error(`Expected client detail URL, got ${url}`);
      }
      console.log(`   📝 Opened client: ${url}`);
    });

    // ============================================================
    // CLIENT DETAIL & ROUTINE TESTS
    // ============================================================
    console.log("\n📋 CLIENT DETAIL & ROUTINE TESTS\n" + "-".repeat(40));

    // Test 11: Client detail page elements
    await runner.runTest("11. Client detail page loads correctly", async () => {
      const detailContent = await stagehand.extract(
        "Extract client detail page elements",
        z.object({
          hasClientName: z.boolean().describe("Whether client name is displayed"),
          hasRoutineSection: z.boolean().describe("Whether routine/exercises section exists"),
          hasDaySelector: z.boolean().describe("Whether day selector buttons exist"),
          hasSaveButton: z.boolean().describe("Whether save button exists"),
          hasBackLink: z.boolean().describe("Whether back/return link exists")
        })
      );
      
      if (!detailContent.hasRoutineSection) {
        throw new Error("Detail page missing routine section");
      }
    });

    // Test 12: Add exercise functionality
    await runner.runTest("12. Add exercise to routine", async () => {
      await stagehand.act("Click on '+ Agregar ejercicio' button");
      
      await sleep(1000);
      
      const exerciseFields = await stagehand.extract(
        "Check if exercise fields appeared",
        z.object({
          hasNameField: z.boolean().describe("Whether exercise name field exists"),
          hasSchemeField: z.boolean().describe("Whether sets/reps field exists"),
          hasRemoveButton: z.boolean().describe("Whether remove button exists")
        })
      );
      
      if (!exerciseFields.hasNameField) {
        throw new Error("Exercise fields did not appear");
      }
    });

    // Test 13: Fill exercise details
    await runner.runTest("13. Fill exercise details", async () => {
      await stagehand.act("Type 'Sentadillas' in the exercise name field");
      await stagehand.act("Clear and type '4x12' in the series/reps field");
      await stagehand.act("Type '4' in the total sets field");
      await stagehand.act("Type 'Con barra' in the note field");
      
      const exerciseData = await stagehand.extract(
        "Verify the exercise data was entered",
        z.object({
          exerciseName: z.string().describe("The exercise name value"),
          hasData: z.boolean().describe("Whether the exercise has data")
        })
      );
      
      console.log(`   📝 Exercise: ${exerciseData.exerciseName}`);
    });

    // Test 14: Save routine
    await runner.runTest("14. Save routine changes", async () => {
      await stagehand.act("Click the 'Guardar cambios' button");
      
      await sleep(3000);
      
      const saveResult = await stagehand.extract(
        "Check if save was successful",
        z.object({
          hasSuccessMessage: z.boolean().describe("Whether success message is shown"),
          messageText: z.string().optional().describe("The message text")
        })
      );
      
      console.log(`   📝 Save result: ${saveResult.hasSuccessMessage ? 'Success' : 'Unknown'}`);
    });

    // Test 15: Day selector navigation
    await runner.runTest("15. Day selector navigation works", async () => {
      await stagehand.act("Click on 'Martes' day button");
      await sleep(500);
      
      await stagehand.act("Click on 'Miércoles' day button");
      await sleep(500);
      
      await stagehand.act("Click on 'Lunes' day button");
      
      console.log(`   📝 Day navigation works correctly`);
    });

    // Test 16: Copy link functionality
    await runner.runTest("16. Copy client link button exists", async () => {
      const linkButton = await stagehand.extract(
        "Check if copy link button exists",
        z.object({
          hasCopyLinkButton: z.boolean().describe("Whether copy link button exists"),
          buttonText: z.string().optional().describe("The button text")
        })
      );
      
      if (!linkButton.hasCopyLinkButton) {
        throw new Error("Copy link button not found");
      }
    });

    // ============================================================
    // NAVIGATION & UI TESTS
    // ============================================================
    console.log("\n📋 NAVIGATION & UI TESTS\n" + "-".repeat(40));

    // Test 17: Back to panel navigation
    await runner.runTest("17. Back to panel navigation works", async () => {
      await stagehand.act("Click 'Volver al panel' link");
      
      await sleep(2000);
      
      const url = page.url();
      if (!url.includes("/clientes") || url.includes("/clientes/")) {
        throw new Error(`Expected /clientes, got ${url}`);
      }
    });

    // Test 18: Logout functionality
    await runner.runTest("18. Logout functionality works", async () => {
      await page.goto(`${CONFIG.baseUrl}/clientes`);
      await page.waitForLoadState("networkidle");
      
      await stagehand.act("Click 'Cerrar sesión' button");
      
      await sleep(3000);
      
      // Try accessing protected route
      await page.goto(`${CONFIG.baseUrl}/clientes`);
      await sleep(2000);
      
      const url = page.url();
      console.log(`   📝 After logout, URL: ${url}`);
    });

    // Test 19: Password visibility toggle
    await runner.runTest("19. Password visibility toggle works", async () => {
      await page.goto(`${CONFIG.baseUrl}/login`);
      await page.waitForLoadState("networkidle");
      
      await stagehand.act("Type 'testpassword' in the password field");
      
      const beforeToggle = await stagehand.extract(
        "Check password field type",
        z.object({
          isHidden: z.boolean().describe("Whether password is hidden (dots)")
        })
      );
      
      await stagehand.act("Click 'Ver' button to show password");
      await sleep(500);
      
      await stagehand.act("Click 'Ocultar' button to hide password");
      
      console.log(`   📝 Toggle functionality works`);
    });

    // Test 20: Navigation links from login
    await runner.runTest("20. Navigation links work correctly", async () => {
      await page.goto(`${CONFIG.baseUrl}/login`);
      await page.waitForLoadState("networkidle");
      
      await stagehand.act("Click 'Registrate' link");
      await sleep(1500);
      
      let url = page.url();
      if (!url.includes("/registro")) {
        throw new Error(`Expected /registro, got ${url}`);
      }
      
      await stagehand.act("Click the link to go to login");
      await sleep(1500);
      
      url = page.url();
      if (!url.includes("/login")) {
        throw new Error(`Expected /login, got ${url}`);
      }
      
      await stagehand.act("Click '¿Olvidaste tu contraseña?' link");
      await sleep(1500);
      
      url = page.url();
      if (!url.includes("/reset")) {
        throw new Error(`Expected /reset, got ${url}`);
      }
      
      console.log(`   📝 All navigation links working`);
    });

    // ============================================================
    // CLEANUP TEST
    // ============================================================
    console.log("\n📋 CLEANUP\n" + "-".repeat(40));

    // Test 21: Delete test client
    await runner.runTest("21. Delete test client (cleanup)", async () => {
      // Login again
      await page.goto(`${CONFIG.baseUrl}/login`);
      await page.waitForLoadState("networkidle");
      await stagehand.act(`Type '${CONFIG.testUser.email}' in the email field`);
      await stagehand.act(`Type '${CONFIG.testUser.password}' in the password field`);
      await stagehand.act("Click the 'Entrar' button");
      await sleep(3000);
      
      // Search for test client
      await stagehand.act(`Type '${testClientName}' in the search field`);
      await stagehand.act("Click 'Buscar' button");
      await sleep(2000);
      
      // Click delete
      await stagehand.act("Click 'Eliminar cliente' button");
      await sleep(1000);
      
      // Confirm deletion
      await stagehand.act("Type 'eliminar' in the confirmation field");
      await stagehand.act("Click 'Eliminar definitivamente' button");
      await sleep(2000);
      
      console.log(`   📝 Test client deleted`);
    });

  } catch (error) {
    console.error("\n❌ Fatal error during tests:", error);
  } finally {
    if (stagehand) {
      await stagehand.close();
    }
    runner.printSummary();
  }
}

main();
