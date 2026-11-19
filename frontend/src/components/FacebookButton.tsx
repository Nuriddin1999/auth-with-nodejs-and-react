import { useEffect } from "react";
import { config } from "../config";
import type { ProviderButtonProps } from "../types";
import UnconfiguredButton from "./UnconfiguredButton";
import { ui } from "../ui";

let sdkPromise: Promise<FacebookSdk> | null = null;

function loadFacebookSdk(): Promise<FacebookSdk> {
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise<FacebookSdk>((resolve, reject) => {
    window.fbAsyncInit = () => {
      const FB = window.FB!;
      FB.init({
        appId: config.facebookAppId,
        cookie: false,
        xfbml: false,
        version: config.facebookGraphVersion,
      });
      resolve(FB);
    };
    const script = document.createElement("script");
    script.src = "https://connect.facebook.net/en_US/sdk.js";
    script.async = true;
    script.defer = true;
    script.crossOrigin = "anonymous";
    script.onerror = () => {
      sdkPromise = null;
      reject(new Error("Could not load Facebook SDK (blocked by an extension?)"));
    };
    document.body.appendChild(script);
  });
  return sdkPromise;
}

/** Opens the Facebook login popup; returns a user access token. */
export default function FacebookButton({ onSuccess, onError, label = "Continue with Facebook" }: ProviderButtonProps) {
  useEffect(() => {
    if (!config.facebookAppId) return;
    loadFacebookSdk().catch((e: Error) => onError(e.message));
  }, [onError]);

  if (!config.facebookAppId) {
    return (
      <UnconfiguredButton
        name="Facebook"
        env="VITE_FACEBOOK_APP_ID"
        provider="facebook"
        onError={onError}
        className={ui.facebook}
        icon={<FacebookIcon />}
      />
    );
  }

  const handleClick = () => {
    if (!window.FB) {
      onError("Facebook SDK is still loading, try again in a moment");
      loadFacebookSdk().catch((e: Error) => onError(e.message));
      return;
    }
    // FB.login must be called synchronously from the click to avoid popup blockers.
    window.FB.login(
      (response) => {
        if (response.authResponse?.accessToken) {
          onSuccess({ access_token: response.authResponse.accessToken });
        } else {
          onError("Facebook sign-in was cancelled");
        }
      },
      { scope: "public_profile,email" },
    );
  };

  return (
    <button className={ui.facebook} onClick={handleClick}>
      <FacebookIcon />
      {label}
    </button>
  );
}

function FacebookIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path
        fill="currentColor"
        d="M24 12.07C24 5.41 18.63 0 12 0S0 5.4 0 12.07C0 18.1 4.39 23.1 10.13 24v-8.44H7.08v-3.49h3.04V9.41c0-3.02 1.8-4.7 4.54-4.7 1.31 0 2.68.24 2.68.24v2.97h-1.5c-1.5 0-1.96.93-1.96 1.89v2.26h3.32l-.53 3.5h-2.8V24C19.62 23.1 24 18.1 24 12.07"
      />
    </svg>
  );
}
