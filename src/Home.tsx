import { useEffect, useState } from "react";
import styled from "styled-components";
import Countdown from "react-countdown";
import { Button, CircularProgress, Snackbar } from "@material-ui/core";
import Alert from "@material-ui/lab/Alert";
import yn from 'yn';

import * as anchor from "@project-serum/anchor";

import { LAMPORTS_PER_SOL } from "@solana/web3.js";

import { useAnchorWallet } from "@solana/wallet-adapter-react";
import { WalletDialogButton } from "@solana/wallet-adapter-material-ui";

import {
  CandyMachine,
  awaitTransactionSignatureConfirmation,
  getCandyMachineState,
  mintOneToken,
  shortenAddress,
} from "./candy-machine";


const MainDiv = styled.div`
  font-family: "sans-serif";
  font-weight: 500`;

const ConnectButton = styled(WalletDialogButton)``;

const CounterText = styled.span``; // add your styles here

const MintContainer = styled.div``; // add your styles here

const MintButton = styled(Button)`
  background-color: #F2E235;
`; // add your styles here

export interface HomeProps {
  candyMachineId: anchor.web3.PublicKey;
  config: anchor.web3.PublicKey;
  connection: anchor.web3.Connection;
  startDate: number;
  treasury: anchor.web3.PublicKey;
  txTimeout: number;
}

const Home = (props: HomeProps) => {
  const [api_url, setUrl] = useState(process.env.REACT_APP_API_URL)
  const [balance, setBalance] = useState<number>();
  const [isActive, setIsActive] = useState(false); // true when countdown completes
  const [isSoldOut, setIsSoldOut] = useState(false); // true when items remaining is zero
  const [isMinting, setIsMinting] = useState(false); // true when user got to press MINT
  const [isWhitelisted, SetWhitelisted] = useState(false);

  const [itemsAvailable, setItemsAvailable] = useState(0);
  const [itemsRedeemed, setItemsRedeemed] = useState(0);
  const [itemsRemaining, setItemsRemaining] = useState(0);

  const [alertState, setAlertState] = useState<AlertState>({
    open: false,
    message: "",
    severity: undefined,
  });

  const [startDate, setStartDate] = useState(new Date(props.startDate));

  const wallet = useAnchorWallet();
  const [candyMachine, setCandyMachine] = useState<CandyMachine>();
  const refreshCandyMachineState = () => {
    (async () => {
      if (!wallet) return;

      const {
        candyMachine,
        goLiveDate,
        itemsAvailable,
        itemsRemaining,
        itemsRedeemed,
      } = await getCandyMachineState(
        wallet as anchor.Wallet,
        props.candyMachineId,
        props.connection
      );

      setItemsAvailable(itemsAvailable);
      setItemsRemaining(itemsRemaining);
      setItemsRedeemed(itemsRedeemed);

      setIsSoldOut(itemsRemaining === 0);
      setStartDate(goLiveDate);
      setCandyMachine(candyMachine);

    })();
  };

  const onMint = async () => {
    try {
      const WHITELIST_ENABLED = yn(process.env.REACT_APP_WHITELIST_ENABLED);
      console.log(WHITELIST_ENABLED);
      let res_num=10000;
      if(WHITELIST_ENABLED){
        let res = await fetch(`${api_url}/whitelisted/member/${(wallet as anchor.Wallet).publicKey.toString()}`, {method: "GET"})
        const res_json = await res.json()
        res_num = await JSON.parse(JSON.stringify(res_json)).reserve //The number  of reserves the user has left
        if(!isWhitelisted){
          throw new Error("You are not whitelisted");
        }
        if(res_num - 1 < 0){
          console.log("confirmed")
          throw new Error("Not enough reserves");
        }
      }

      setIsMinting(true);
      if (wallet && candyMachine?.program) {
        const mintTxId = await mintOneToken(
          candyMachine,
          props.config,
          wallet.publicKey,
          props.treasury
        );

        const status = await awaitTransactionSignatureConfirmation(
          mintTxId,
          props.txTimeout,
          props.connection,
          "singleGossip",
          false
        );

        if (!status?.err) {
          setAlertState({
            open: true,
            message: "Congratulations! Mint succeeded!",
            severity: "success",
          });

          if(WHITELIST_ENABLED){
            const to_send = await JSON.stringify({"reserve": res_num-1})
            await fetch(`${api_url}/whitelisted/update/${(wallet as anchor.Wallet).publicKey.toString()}/${process.env.REACT_APP_SECRET_KEY}`, {
              method: "PUT",
              headers: {
                'Content-Type': 'application/json',
              },
              body: to_send})
            console.log("Updated Reserves for user");
          }

        } else {
          setAlertState({
            open: true,
            message: "Mint failed! Please try again!",
            severity: "error",
          });
        }
      }

    } catch (error: any) {
      // TODO: blech:
      let message = error.message || "Minting failed! Please try again!";
      if (!error.message) {
        if (error.message.indexOf("0x138")) {
        } else if (error.message.indexOf("0x137")) {
          message = `Minting is temporarly on hold, try again shortly`;
        } else if (error.message.indexOf("0x135")) {
          message = `Insufficient funds to mint. Please fund your wallet.`;
        }
      } else {
        if (error.code === 311) {
          message = `Minting is temporarly on hold, try again shortly`;
          setIsSoldOut(true);
        } else if (error.code === 312) {
          message = `Minting period hasn't started yet.`;
        } else if (error.message === "You are not whitelisted"){
          message = error.message;
        } else if (error.message === "Not enough reserves"){
          message = error.message
        }
      }

      setAlertState({
        open: true,
        message,
        severity: "error",
      });
    } finally {
      if (wallet) {
        const balance = await props.connection.getBalance(wallet.publicKey);
        setBalance(balance / LAMPORTS_PER_SOL);
      }

      setIsMinting(false);
      refreshCandyMachineState();
    }
  };

  useEffect(() => {
    (async () => {
      if (wallet) {
        const balance = await props.connection.getBalance(wallet.publicKey);
        setBalance(balance / LAMPORTS_PER_SOL);
        const WHITELIST_ENABLED =  yn(process.env.REACT_APP_WHITELIST_ENABLED);
        if(WHITELIST_ENABLED){
          const data = await fetch(`${api_url}/whitelisted/member/${(wallet as anchor.Wallet).publicKey.toString()}`)
          if(data.status.toString() !== "404"){
            SetWhitelisted(true)
          }
          else{
            console.log("not found")
          }
        }
      }
    })();
  }, [wallet, props.connection]);

  useEffect(refreshCandyMachineState, [
    wallet,
    props.candyMachineId,
    props.connection,
  ]);

  return (
      <MainDiv>

    <main>
      {wallet && (
        <p>Wallet {shortenAddress(wallet.publicKey.toBase58() || "")}</p>
      )}

      {<p>Price: <b> 0.8 SOL </b></p>}
      {wallet && <p>Balance: <b>{(balance || 0).toLocaleString()} SOL</b></p>}

      {wallet && <p>Redeemed: <b>  {itemsRedeemed + 2000} Bastards </b></p>}
      {wallet && <p>Remaining Bastards: <b> {itemsRemaining + 369}/3369 </b></p>}


      <MintContainer>
        {!wallet ? (
          <ConnectButton>Connect Wallet</ConnectButton>
        ) : (
          <MintButton
            disabled={(  (yn(process.env.REACT_APP_WHITELIST_ENABLED) && !isWhitelisted) || isSoldOut || isMinting || !isActive )} //change happened here
            onClick={onMint}
            variant="contained"
          >
            {isSoldOut ? (
              "Minting is temporarly on hold, try again shortly"
            ) : isActive ? (
              isMinting ? (
                <CircularProgress />
              ) : (
                "MINT"
              )
            ) : (
              <Countdown
                date={startDate}
                onMount={({ completed }) => completed && setIsActive(true)}
                onComplete={() => setIsActive(true)}
                renderer={renderCounter}
              />
            )}
          </MintButton>
        )}
      </MintContainer>

      <Snackbar
        open={alertState.open}
        autoHideDuration={6000}
        onClose={() => setAlertState({ ...alertState, open: false })}
      >
        <Alert
          onClose={() => setAlertState({ ...alertState, open: false })}
          severity={alertState.severity}
        >
          {alertState.message}
        </Alert>
      </Snackbar>
    </main>
      </MainDiv>
  );
};

interface AlertState {
  open: boolean;
  message: string;
  severity: "success" | "info" | "warning" | "error" | undefined;
}

const renderCounter = ({ days, hours, minutes, seconds, completed }: any) => {
  return (
    <CounterText>
      {hours + (days || 0) * 24} hours, {minutes} minutes, {seconds} seconds
    </CounterText>
  );
};

export default Home;
