declare global {
	namespace App {}

	interface Window {
		logdash?: Readonly<{
			// It leaves out a prop that is undefined.
			track(name: string, props?: Record<string, string | number | boolean | undefined>): void;
		}>;
	}
}

export {};
