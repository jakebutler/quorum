/// <reference types="vite/client" />

declare module "virtual:quorum-content" {
  export const quorumContent: {
    config: Partial<import("./lib/types").QuorumConfig>;
    welcome: string;
    thankyou: string;
    reviews: import("./lib/types").ReviewOption[];
  };
}
