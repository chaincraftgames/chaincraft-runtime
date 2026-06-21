import { PinataSDK } from "pinata-web3";

const pinataGateway = process.env.CHAINCRAFT_PINATA_GATEWAY;
const pinataJwt = process.env.CHAINCRAFT_PINATA_JWT;

let pinata: PinataSDK | undefined = undefined;

const getPinata = () => {
  if (pinata) {
    return pinata;
  }

  if (!pinataJwt) {
    throw new Error("Pinata JWT key is not set in environment variables.");
  }

  pinata = new PinataSDK({
    pinataJwt: `${pinataJwt}`,
    pinataGateway: `${pinataGateway}`,
  });

  return pinata;
};

export const getIpfsFile = async (hash: string) => {
  try {
    const data = (await getPinata().gateways.get(hash))?.data;
    return data;
  } catch (error) {
    console.log(error);
  }
};
