"use client";

import { useState, useEffect } from "react";
import {
  BrowserWallet,
  MeshWallet,
  BlockfrostProvider,
  serializePlutusScript,
  UTxO,
  MeshTxBuilder,
  Asset,
  deserializeAddress,
  mConStr0,
  stringToHex,
  Wallet,
} from "@meshsdk/core";
import {
  MeshProvider,
  useWallet,
  useAddress,
  useNetwork,
} from "@meshsdk/react";
import { applyParamsToScript } from "@meshsdk/core-csl";
import blueprint from "../../plutus.json";

const blockchainProvider = new BlockfrostProvider(
  process.env.NEXT_PUBLIC_BLOCKFROST_PROJECT_ID as string
);

//types
interface TransactionFormMinionProps {
  connected: boolean;
  isSubmitting: boolean;
  recipientAddress: string;
  setRecipientAddress: (address: string) => void;
  amount: string;
  setAmount: (amount: string) => void;
  status: string;
  handleSendTransaction: (e: React.FormEvent) => void;
}
interface WalletConnectMinionProps {
  connected: boolean;
  isLoadingWallets: boolean;
  connecting: boolean;
  availableWallets: Wallet[];
  handleConnect: (walletName: string) => void;
  disconnect: () => void;
  connect: (walletName: string, persist?: boolean) => Promise<void>;
}
interface WalletInfoMinionProps {
  address: string | null;
  network: number | null;
  balance: any;
  loading: boolean;
}

// Main App Component (wraps everything with MeshProvider)
export default function Home() {
  return (
    <MeshProvider>
      <div className="min-h-screen bg-gray-100 py-10">
        <div className="max-w-3xl mx-auto bg-white rounded-xl shadow-md overflow-hidden p-6">
          <h1 className="text-3xl font-bold text-center text-blue-600 mb-8">
            Cardano Simple DApp
          </h1>
          <CardanoApp />
        </div>
      </div>
    </MeshProvider>
  );
}

// Unified Cardano App Component
function CardanoApp() {
  const {
    connected,
    wallet,
    connect,
    disconnect,
    connecting,
    setWallet,
    setWeb3Services,
  } = useWallet();

  const [loadingWallets, setLoadingWallets] = useState(true);
  const address = useAddress();
  const network = useNetwork();
  const [availableWallets, setAvailableWallets] = useState<Wallet[]>([]);
  const [balance, setBalance] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [recipientAddress, setRecipientAddress] = useState("");
  const [amount, setAmount] = useState("");
  const [status, setStatus] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    setAvailableWallets(BrowserWallet.getInstalledWallets());
    setLoadingWallets(false);
    setWeb3Services({
      networkId: 0,
      fetcher: blockchainProvider,
      submitter: blockchainProvider,
    });
  }, []);

  // Fetch balance when wallet connection changes
  useEffect(() => {
    const getBalance = async () => {
      if (connected && wallet) {
        try {
          setLoading(true);
          const balanceDetails = await wallet.getBalance();
          setBalance(balanceDetails);
        } catch (error) {
          console.error("Error fetching balance:", error);
        } finally {
          setLoading(false);
        }
      }
    };

    getBalance();
  }, [connected, wallet]);

  const handleConnect = async (walletName: string) => {
    try {
      const connectedWallet = await BrowserWallet.enable(walletName);
      setWallet(connectedWallet, connectedWallet._walletName, {
        wallet: true
      });
    } catch (error) {
      console.error("Error connecting wallet:", error);
    }
  };

  const handleSendTransaction = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!recipientAddress || !amount) {
      setStatus("Please fill in all fields");
      return;
    }

    try {
      setIsSubmitting(true);
      setStatus("Building transaction...");

      const lovelaceAmount = parseInt(
        (parseFloat(amount) * 1000000).toString()
      );

      const tx = {
        outputs: [
          {
            address: recipientAddress,
            amount: { lovelace: lovelaceAmount.toString() },
          },
        ],
      };

      setStatus("Waiting for user to sign transaction...");
      const signedTx = await wallet.signTx(tx);

      setStatus("Submitting transaction...");
      const txHash = await wallet.submitTx(signedTx);

      setStatus(`Transaction submitted successfully! Hash: ${txHash}`);

      // Reset the form
      setRecipientAddress("");
      setAmount("");
    } catch (error: any) {
      console.error(error);
      setStatus(`Error: ${error.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Render subcomponents with shared state
  return (
    <div className="space-y-8">
      {/* Wallet Connection UI */}
      <WalletConnectMinion
        connected={connected}
        isLoadingWallets={loadingWallets}
        connecting={connecting}
        availableWallets={availableWallets}
        handleConnect={handleConnect}
        disconnect={disconnect}
        connect={connect}
      />

      {connected ? (
        <>
          {/* Wallet Info UI */}
          <WalletInfoMinion
            address={address as string}
            network={network as number}
            balance={balance}
            loading={loading}
          />

          {/* Transaction UI */}
          <TransactionFormMinion
            connected={connected}
            isSubmitting={isSubmitting}
            recipientAddress={recipientAddress}
            setRecipientAddress={setRecipientAddress}
            amount={amount}
            setAmount={setAmount}
            status={status}
            handleSendTransaction={handleSendTransaction}
          />

          {/* Asset Lock/Unlock UI */}
          <AssetLockUnlockMinion
            connected={connected}
            wallet={wallet as MeshWallet}
          />
        </>
      ) : (
        <div className="p-6 bg-gray-50 rounded-lg text-center">
          <p className="text-gray-600">
            Please connect your wallet to use the DApp.
          </p>
        </div>
      )}
    </div>
  );
}

async function initiateLock(wallet: MeshWallet) {
  // these are the assets we want to lock into the contract
  const assets: Asset[] = [
    {
      unit: "lovelace",
      quantity: "1000000",
    },
  ];

  // get utxo and wallet address
  const utxos = await wallet.getUtxos();
  const walletAddress = (await wallet.getUsedAddresses())[0];

  const { scriptAddr } = getScript();

  // hash of the public key of the wallet, to be used in the datum
  const signerHash = deserializeAddress(walletAddress).pubKeyHash;

  // build transaction with MeshTxBuilder
  const txBuilder = getTxBuilder();
  await txBuilder
    .txOut(scriptAddr, assets) // send assets to the script address
    .txOutDatumHashValue(mConStr0([signerHash])) // provide the datum where `"constructor": 0`
    .changeAddress(walletAddress) // send change back to the wallet address
    .selectUtxosFrom(utxos)
    .complete();
  const unsignedTx = txBuilder.txHex;

  const signedTx = await wallet.signTx(unsignedTx);
  const txHash = await wallet.submitTx(signedTx);
  return {
    message: `1 tADA locked into the contract at Tx ID: ${txHash}`,
    txHash,
  };
}

async function initiateUnlock(wallet: MeshWallet, txHashFromDesposit: string) {
  const utxos = await wallet.getUtxos();
  const walletAddress = (await wallet.getUsedAddresses())[0];
  const collateral = (await wallet.getCollateral())[0];
  console.log({
    wallet,
    collateral,
    walletAddress,
    txHashFromDesposit,
    utxos,
  });

  const { scriptCbor } = getScript();

  // hash of the public key of the wallet, to be used in the datum
  const signerHash = deserializeAddress(walletAddress).pubKeyHash;
  // redeemer value to unlock the funds
  const message = "Hello, World!";

  // get the utxo from the script address of the locked funds
  const scriptUtxo = await getUtxoByTxHash(txHashFromDesposit);

  // build transaction with MeshTxBuilder
  const txBuilder = getTxBuilder();
  await txBuilder
    .spendingPlutusScript("V3") // we used plutus v3
    .txIn(
      // spend the utxo from the script address
      scriptUtxo.input.txHash,
      scriptUtxo.input.outputIndex,
      scriptUtxo.output.amount,
      scriptUtxo.output.address
    )
    .txInScript(scriptCbor)
    .txInRedeemerValue(mConStr0([stringToHex(message)])) // provide the required redeemer value `Hello, World!`
    .txInDatumValue(mConStr0([signerHash])) // only the owner of the wallet can unlock the funds
    .requiredSignerHash(signerHash)
    .changeAddress(walletAddress)
    .txInCollateral(
      collateral.input.txHash,
      collateral.input.outputIndex,
      collateral.output.amount,
      collateral.output.address
    )
    .selectUtxosFrom(utxos)
    .complete();
  const unsignedTx = txBuilder.txHex;

  const signedTx = await wallet.signTx(unsignedTx);
  const txHash = await wallet.submitTx(signedTx);
  console.log(`1 tADA unlocked from the contract at Tx ID: ${txHash}`);
  return {
    message: `1 tADA unlocked from the contract at Tx ID: ${txHash}`,
    txHash,
  };
}

function getScript() {
  const scriptCbor = applyParamsToScript(
    blueprint.validators[0].compiledCode,
    []
  );

  const scriptAddr = serializePlutusScript({
    code: scriptCbor,
    version: "V3",
  }).address;

  return { scriptCbor, scriptAddr };
}

export function getTxBuilder() {
  return new MeshTxBuilder({
    fetcher: blockchainProvider,
    submitter: blockchainProvider,
  });
}

// reusable function to get a UTxO by transaction hash
export async function getUtxoByTxHash(txHash: string): Promise<UTxO> {
  const utxos = await blockchainProvider.fetchUTxOs(txHash);
  if (utxos.length === 0) {
    throw new Error("UTxO not found");
  }
  return utxos[0];
}

// Wallet Connect Minion (UI-only component)
function WalletConnectMinion({
  connected,
  connecting,
  availableWallets,
  isLoadingWallets,
  handleConnect,
  disconnect,
  connect,
}: WalletConnectMinionProps) {
  return (
    <div className="flex flex-col items-center">
      {connecting ? (
        <div className="p-4 bg-blue-50 rounded-lg">
          <p className="text-blue-700">Connecting to wallet...</p>
        </div>
      ) : connected ? (
        <div className="flex space-x-4">
          <button
            onClick={() => disconnect()}
            className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors cursor-pointer"
          >
            Disconnect Wallet
          </button>
          <button
            onClick={() => connect()}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors cursor-pointer"
          >
            Reconnect Wallet
          </button>
        </div>
      ) : (
        <div>
          <h2 className="text-xl font-semibold text-center mb-4">
            Connect Wallet
          </h2>
          <div className="flex flex-wrap justify-center gap-2">
            {isLoadingWallets ? (
              <p className="text-gray-600">Loading wallets...</p>
            ) : (
              availableWallets.map((wallet) => (
                <button
                  key={wallet.id}
                  onClick={() => handleConnect(wallet.name)}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors cursor-pointer flex items-center"
                >
                  <img
                    src={wallet.icon}
                    alt={wallet.name}
                    className="inline-block mr-2"
                    width={24}
                    height={24}
                  />
                  Connect {wallet.name}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Wallet Info Minion (UI-only component)
function WalletInfoMinion({
  address,
  network,
  balance,
  loading,
}: WalletInfoMinionProps) {
  const adaBalance = Array.isArray(balance)
    ? balance.find((b) => b.unit === "lovelace")
    : null;
  const nativeAssets = Array.isArray(balance)
    ? balance.filter((b) => b.unit !== "lovelace")
    : [];
  const getNetworkNameFromId = (networkId: number) => {
    switch (networkId) {
      case 1:
        return "Mainnet";
      case 0:
        return "Testnet";
      default:
        return "Unknown";
    }
  };
  return (
    <div className="bg-gray-50 rounded-lg p-6">
      <h2 className="text-xl font-semibold text-blue-600 mb-4">
        Wallet Information
      </h2>

      <div className="space-y-3">
        <p>
          <span className="font-medium">Network:</span>{" "}
          {network !== null ? getNetworkNameFromId(network) : "Not connected"}
        </p>

        <p>
          <span className="font-medium">Address:</span>{" "}
          {address ? (
            <span className="font-mono text-sm break-all">
              {`${address.slice(0, 20)}...${address.slice(-8)}`}
            </span>
          ) : (
            "Not connected"
          )}
        </p>

        <p>
          <span className="font-medium">Balance:</span>{" "}
          {loading
            ? "Loading..."
            : balance
            ? `${parseInt(adaBalance.quantity) / 1000000} ADA`
            : "0 ADA"}
        </p>

        <p>
          <span className="font-medium">Native Assets:</span>{" "}
          {loading
            ? "Loading..."
            : balance
            ? nativeAssets.length > 0
              ? nativeAssets.map((asset) => (
                  <span key={asset.unit} className="block">
                    {`${asset.quantity} ${asset.unit}`}
                  </span>
                ))
              : "No native assets"
            : "0"}
        </p>
      </div>
    </div>
  );
}

// Transaction Form Minion (UI-only component)
function TransactionFormMinion({
  connected,
  isSubmitting,
  recipientAddress,
  setRecipientAddress,
  amount,
  setAmount,
  status,
  handleSendTransaction,
}: TransactionFormMinionProps) {
  return (
    <div className="bg-gray-50 rounded-lg p-6">
      <h2 className="text-xl font-semibold text-blue-600 mb-4">Send ADA</h2>

      <form onSubmit={handleSendTransaction} className="space-y-4">
        <div className="space-y-2">
          <label htmlFor="recipient" className="block font-medium">
            Recipient Address:
          </label>
          <input
            type="text"
            id="recipient"
            value={recipientAddress}
            onChange={(e) => setRecipientAddress(e.target.value)}
            placeholder="addr1..."
            className="w-full p-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            required
          />
        </div>

        <div className="space-y-2">
          <label htmlFor="amount" className="block font-medium">
            Amount (ADA):
          </label>
          <input
            type="number"
            id="amount"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            step="0.1"
            min="0"
            className="w-full p-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            required
          />
        </div>

        <button
          type="submit"
          disabled={!connected || isSubmitting}
          className={`w-full py-2 px-4 rounded-md text-white font-medium 
            ${
              !connected || isSubmitting
                ? "bg-gray-400 cursor-not-allowed"
                : "bg-blue-600 hover:bg-blue-700"
            }`}
        >
          {isSubmitting ? "Processing..." : "Send Transaction"}
        </button>
      </form>

      {status && (
        <div className="mt-4 p-3 bg-blue-50 border-l-4 border-blue-500 text-blue-700">
          {status}
        </div>
      )}
    </div>
  );
}

function AssetLockUnlockMinion({
  connected,
  wallet,
}: {
  connected: boolean;
  wallet: MeshWallet;
}) {
  const [lockStatus, setlockStatus] = useState("");
  const [unlockStatus, setUnlockStatus] = useState("");
  const [txHashFromLockDesposit, setTxHashFromLockDesposit] = useState("");
  const [txHashFromUnlockDesposit, setTxHashFromUnlockDesposit] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const handleLock = async () => {
    if (connected && wallet) {
      try {
        setIsSubmitting(true);
        setlockStatus("Locking assets...");
        const { message, txHash } = await initiateLock(wallet);
        setlockStatus(message);
        setTxHashFromLockDesposit(txHash);
        setIsSubmitting(false);
      } catch (error) {
        console.error("Error locking assets:", error);
        setlockStatus(`Error: ${error.message}`);
      } finally {
        setIsSubmitting(false);
      }
    } else {
      setlockStatus("Please connect your wallet first.");
    }
  };
  const handleUnlock = async () => {
    if (connected && wallet) {
      try {
        if (!txHashFromLockDesposit) {
          setUnlockStatus("Please enter the transaction hash.");
          return;
        }
        setIsSubmitting(true);
        setUnlockStatus("Unlocking assets...");
        const { message, txHash } = await initiateUnlock(
          wallet,
          txHashFromLockDesposit
        );
        setUnlockStatus(message);
        setTxHashFromUnlockDesposit(txHash);
        setIsSubmitting(false);
      } catch (error) {
        console.error("Error unlocking assets:", error);
        setUnlockStatus(`Error: ${error.message}`);
      } finally {
        setIsSubmitting(false);
      }
    } else {
      setUnlockStatus("Please connect your wallet first.");
    }
  };
  return (
    <>
      <div className="bg-gray-50 rounded-lg p-6">
        <h2 className="text-xl font-semibold text-blue-600 mb-4">
          Lock/Unlock Assets
        </h2>
        <button
          onClick={handleLock}
          disabled={!connected || isSubmitting}
          className={`w-full py-2 px-4 rounded-md text-white font-medium 
            ${
              !connected || isSubmitting
                ? "bg-gray-400 cursor-not-allowed"
                : "bg-blue-600 hover:bg-blue-700"
            }`}
        >
          {isSubmitting ? "Processing..." : "Lock Assets"}
        </button>
        {lockStatus && (
          <div className="mt-4 p-3 bg-blue-50 border-l-4 border-blue-500 text-blue-700">
            {lockStatus}
          </div>
        )}
        {txHashFromLockDesposit && (
          <div className="mt-4 p-3 bg-blue-50 border-l-4 border-blue-500 text-blue-700">
            <p className="font-medium">Transaction Hash:</p>
            <span className="font-mono text-sm break-all">
              {`${txHashFromLockDesposit.slice(
                0,
                20
              )}...${txHashFromLockDesposit.slice(-8)}`}
            </span>
            <br />
            <a
              href={`https://preview.cardanoscan.io/transaction/${txHashFromLockDesposit}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 hover:underline
              "
            >
              View lock deposit transation on CardanoScan
            </a>
          </div>
        )}
        {txHashFromUnlockDesposit && (
          <div className="mt-4 p-3 bg-blue-50 border-l-4 border-blue-500 text-blue-700">
            <p className="font-medium">Transaction Hash:</p>
            <span className="font-mono text-sm break-all">
              {`${txHashFromUnlockDesposit.slice(
                0,
                20
              )}...${txHashFromUnlockDesposit.slice(-8)}`}
            </span>
            <br />
            <a
              href={`https://preview.cardanoscan.io/transaction/${txHashFromUnlockDesposit}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 hover:underline
              "
            >
              View unlock deposit transation on CardanoScan
            </a>
          </div>
        )}
      </div>
      <div className="bg-gray-50 rounded-lg p-6">
        <h2 className="text-xl font-semibold text-blue-600 mb-4">
          Unlock Assets
        </h2>
        <p className="mb-4">
          To unlock assets, please enter the transaction hash of the deposit
          transaction.
        </p>
        <input
          type="text"
          placeholder="Transaction Hash"
          className="w-full p-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 mb-4"
          value={txHashFromLockDesposit}
          onChange={(e) => setTxHashFromLockDesposit(e.target.value)}
        />
        <button
          onClick={handleUnlock}
          disabled={!connected || isSubmitting}
          className={`w-full py-2 px-4 rounded-md text-white font-medium 
            ${
              !connected || isSubmitting
                ? "bg-gray-400 cursor-not-allowed"
                : "bg-blue-600 hover:bg-blue-700"
            }`}
        >
          {isSubmitting ? "Processing..." : "Unlock Assets"}
        </button>
        {unlockStatus && (
          <div className="mt-4 p-3 bg-blue-50 border-l-4 border-blue-500 text-blue-700">
            {unlockStatus}
          </div>
        )}
      </div>
    </>
  );
}
const arr = ['a', 'b', 'c'];
for (const item of arr) {
  console.log(item);
}

arr.find