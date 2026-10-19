/**
 * #4617: a turn-end advisory produced in the current turn must not be labelled
 * "Historical finding" just because the turn wrote no file (bash-only turn).
 * Drives the real `handleTurnEnd` and the real delivery path.
 */
import * as path from "node:path";
import {
	afterAll,
	afterEach,
	beforeAll,
	describe,
	expect,
	it,
	vi,
} from "vitest";

import { validateAdvisoryProvenance } from "../../clients/advisory-provenance.js";
import { CacheManager } from "../../clients/cache-manager.js";
import {
	deferRunnerFindings,
	resetPendingRunnerFindings,
} from "../../clients/dispatch/pending-runner-findings.js";
import { _resetInstanceRegistryEnabledForTests } from "../../clients/instance-registry.js";
import { RuntimeCoordinator } from "../../clients/runtime-coordinator.js";
import { consumeTurnEndFindings } from "../../clients/runtime-context.js";
import {
	cancelLSPIdleReset,
	handleTurnEnd,
} from "../../clients/runtime-turn.js";
import { setupTestEnvironment } from "./test-utils.js";

beforeAll(() => {
	vi.stubEnv("PI_LENS_INSTANCE_REGISTRY", "0");
	_resetInstanceRegistryEnabledForTests();
});
afterAll(() => {
	vi.unstubAllEnvs();
	_resetInstanceRegistryEnabledForTests();
});
afterEach(() => {
	cancelLSPIdleReset();
	resetPendingRunnerFindings();
});

function deps(
	runtime: RuntimeCoordinator,
	cacheManager: CacheManager,
	cwd: string,
) {
	return {
		ctxCwd: cwd,
		getFlag: () => false,
		dbg: () => {},
		runtime,
		cacheManager,
		knipClient: {
			ensureAvailable: async () => false,
			analyze: async () => ({
				success: true,
				issues: [],
				unusedExports: [],
				unusedFiles: [],
				unusedDeps: [],
				unlistedDeps: [],
				summary: "skipped",
			}),
		},
		deadCodeClients: [],
		depChecker: { ensureAvailable: async () => false },
		testRunnerClient: { getTestRunTarget: () => null },
		resetLSPService: () => {},
		resetFormatService: () => {},
	} as any;
}

describe("turn-end provenance on no-write turns (#4617)", () => {
	it("delivers a same-turn advisory without the historical label", async () => {
		const env = setupTestEnvironment("pi-lens-bash-only-prov-");
		try {
			const runtime = new RuntimeCoordinator();
			runtime.setTelemetryIdentity({ sessionId: "bash-only-session" });
			runtime.beginTurn();
			const cacheManager = new CacheManager(false);
			// A deferred runner settled during this bash-only turn: no file was
			// written, yet the turn-end advisory is produced right now.
			const filePath = path.join(env.tmpDir, "late.ts");
			deferRunnerFindings({
				filePath,
				cwd: env.tmpDir,
				projectRoot: env.tmpDir,
				runnerId: "late-runner",
				markedAtMs: Date.now(),
				promise: Promise.resolve({
					status: "failed",
					failureKind: "timeout",
					diagnostics: [],
					semantic: "none",
				} as any),
			});
			await new Promise<void>((r) => setImmediate(r));
			await new Promise<void>((r) => setImmediate(r));

			await handleTurnEnd(deps(runtime, cacheManager, env.tmpDir));

			const stored = cacheManager.readCache<{ content?: string }>(
				"turn-end-findings",
				env.tmpDir,
			);
			expect(stored?.data?.content).toBeTruthy();
			const delivered = consumeTurnEndFindings(
				cacheManager,
				env.tmpDir,
				runtime,
			);
			const text = delivered?.messages[0]?.content as string;
			expect(text).toBeTruthy();
			expect(text).not.toContain("Historical finding");
		} finally {
			env.cleanup();
		}
	});

	it("validates an empty-files record by session and never as all-deleted", () => {
		const provenance = (sessionId: string) => ({
			revision: {
				sessionId,
				projectSeq: 1,
				turnIndex: 1,
				generation: 1,
				capturedAt: 1,
			},
			files: [],
		});
		const runtime = { telemetrySessionId: "s1", projectSeq: 1, turnIndex: 1 };
		const same = validateAdvisoryProvenance(
			{ provenance: provenance("s1") },
			process.cwd(),
			runtime,
		);
		expect(same).toMatchObject({ status: "current", allFilesDeleted: false });
		const other = validateAdvisoryProvenance(
			{ provenance: provenance("s0") },
			process.cwd(),
			runtime,
		);
		expect(other).toMatchObject({
			status: "superseded",
			reasons: ["session-mismatch"],
			allFilesDeleted: false,
		});
	});
});
