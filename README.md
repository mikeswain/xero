

    git clone git@github.com:mikeswain/xero.git
    cd xero
    npm install
    npm start

    In your browser navigate to http://localhost:3030/xero/connect

    Log into xero, click yes
    it should redirect to a load of json to show its worked

    You can then call

    localhost:3030/payments/<studentid> to get a list of payments for a Xero contact

    e.g 

    localhost:3030/payments/270037608

