declare global {
	namespace App {}

	interface Window {
		logdash?: Readonly<{
			track(name: string, props?: Record<string, string | number | boolean>): void;
		}>;
	}
}

export {};
